import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasTestDatabase } from "../helpers";

// 分析（Phase 4）の統合テスト。SNS・AI・キューは Mock／記録用に差し替える
describe.skipIf(!hasTestDatabase)("分析（統合）", async () => {
  const { prisma } = await import("@/lib/database/prisma");
  const metricsService = await import("@/lib/analytics/metrics-service");
  const analytics = await import("@/lib/analytics/analytics-service");
  const analysis = await import("@/lib/analytics/analysis-service");
  const agent = await import("@/lib/agent/agent-service");
  const dashboard = await import("@/lib/dashboard/dashboard-service");
  const { setAIProvider } = await import("@/lib/ai/registry");
  const { MockAIProvider } = await import("@/lib/ai/mock-provider");
  const { setJobDispatcher } = await import("@/lib/queue/jobs");
  const { setPublishScheduler } = await import("@/lib/queue/post-queue");
  const { MOCK_NO_METRICS_KEY } = await import("@/lib/social/mock/mock-adapter");
  const accounts = await import("@/lib/social/account-service");

  const analysisJobs: string[] = [];
  const refreshJobs: string[] = [];
  setPublishScheduler({ async schedule() {}, async cancel() {} });
  setJobDispatcher({
    async enqueueMedia() {},
    async enqueueAgentRun() {},
    async upsertWeeklyAgent() {},
    async removeWeeklyAgent() {},
    async enqueueMetricsRefresh(userId) {
      refreshJobs.push(userId);
    },
    async enqueueAnalysis(reportId) {
      analysisJobs.push(reportId);
    },
  });

  // 2026-10-29(木) 09:00 JST
  const NOW = new Date("2026-10-29T00:00:00.000Z");
  const daysAgo = (d: number, hourJst = 12) => new Date(NOW.getTime() - d * 86_400_000 + (hourJst - 9) * 3_600_000);
  let userId: string;
  let otherUserId: string;
  let brandId: string;
  let xId: string;
  let threadsId: string;
  let noMetricsId: string;
  let ai: InstanceType<typeof MockAIProvider>;

  async function publishedPost(title: string, pillar: string, accountId: string, platform: "X" | "THREADS", publishedAt: Date) {
    const post = await prisma.post.create({
      data: { userId, brandId, title, contentPillar: pillar, status: "PUBLISHED", approvalStatus: "APPROVED", scheduledAt: publishedAt },
    });
    await prisma.postPlatform.create({
      data: {
        postId: post.id,
        platform,
        socialAccountId: accountId,
        accountName: "@acc",
        content: `${title}の本文`,
        status: "PUBLISHED",
        idempotencyKey: `${post.id}:${accountId}`,
        publishedAt,
        externalPostId: `ext-${randomUUID()}`,
      },
    });
    return post;
  }

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `analytics-${randomUUID()}@example.com`, passwordHash: "x" } })).id;
    otherUserId = (await prisma.user.create({ data: { email: `analytics-other-${randomUUID()}@example.com`, passwordHash: "x" } })).id;
    brandId = (await prisma.brand.create({ data: { userId, name: "Lounge+", contentPillars: ["カフェ", "ラウンジ"] } })).id;
    const x = (s: string) => ({ apiKey: "k", apiSecret: "s", accessToken: `analytics-${s}`, accessTokenSecret: "t" });
    xId = (await accounts.connectAccount(userId, "X", { credentials: x("ok") })).id;
    noMetricsId = (await accounts.connectAccount(userId, "X", { credentials: x(MOCK_NO_METRICS_KEY) })).id;
    threadsId = (await accounts.connectAccount(userId, "THREADS", { credentials: { accessToken: "analytics-threads" } })).id;
  });

  beforeEach(async () => {
    // 実際の日付が進んでもテストが壊れないよう、Date だけを NOW に固定する
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    ai = new MockAIProvider();
    setAIProvider(ai);
    analysisJobs.length = 0;
    refreshJobs.length = 0;
    await prisma.post.deleteMany({ where: { userId } });
    await prisma.analysisReport.deleteMany({ where: { userId } });
    await prisma.agentRun.deleteMany({ where: { userId } });
    await prisma.accountMetric.deleteMany({ where: { socialAccount: { userId } } });
  });

  afterEach(() => {
    setAIProvider(null);
    vi.useRealTimers();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("投稿から30日以内の投稿の数値とフォロワー数を保存し、取得できないアカウントには理由を残す", async () => {
    const recent = await publishedPost("最近の投稿", "カフェ", xId, "X", daysAgo(2));
    const threadsPost = await publishedPost("Threads の投稿", "ラウンジ", threadsId, "THREADS", daysAgo(3, 20));
    const old = await publishedPost("古い投稿", "カフェ", xId, "X", daysAgo(40));
    await publishedPost("権限のないアカウントの投稿", "カフェ", noMetricsId, "X", daysAgo(1));

    const summary = await metricsService.collectMetrics({ userId, now: NOW });
    expect(summary.posts).toBe(2);
    const metrics = await prisma.postMetric.findMany({ where: { postPlatform: { post: { userId } } }, include: { postPlatform: true } });
    expect(metrics.map((m) => m.postPlatform.postId).sort()).toEqual([recent.id, threadsPost.id].sort());
    expect(metrics.find((m) => m.platform === "THREADS")?.saves).toBeNull();
    expect(metrics.every((m) => m.postPlatform.postId !== old.id)).toBe(true);

    const noMetrics = await prisma.socialAccount.findUniqueOrThrow({ where: { id: noMetricsId } });
    expect(noMetrics.metricsError).toContain("API プラン");
    expect(noMetrics.metricsCheckedAt?.toISOString()).toBe(NOW.toISOString());
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: xId } })).metricsError).toBeNull();
    expect(summary.errors.map((e) => e.accountId)).toEqual([noMetricsId]);

    // 同じ日に取り直してもフォロワー数は1日1件
    await metricsService.collectMetrics({ userId, now: new Date(NOW.getTime() + 3_600_000) });
    expect(await prisma.accountMetric.count({ where: { socialAccountId: xId } })).toBe(1);
    expect(await prisma.accountMetric.count({ where: { socialAccountId: noMetricsId } })).toBe(0);
  });

  it("分析画面のデータ：期間内の投稿・合計・フォロワーの増減を返す", async () => {
    await publishedPost("A", "カフェ", xId, "X", daysAgo(2));
    await publishedPost("B", "ラウンジ", threadsId, "THREADS", daysAgo(5));
    await prisma.accountMetric.create({ data: { socialAccountId: xId, date: daysAgo(10, 0), followers: 100 } });
    await metricsService.collectMetrics({ userId, now: NOW });

    const data = await analytics.getAnalytics(userId, { brandId, days: 30, now: NOW });
    expect(data.rows).toHaveLength(2);
    expect(data.measured).toBe(2);
    expect(data.totals.views).toBeGreaterThan(0);
    expect(data.totals.reach).toBeNull();
    expect(data.byPillar.map((g) => g.key).sort()).toEqual(["カフェ", "ラウンジ"]);
    const x = data.accounts.find((a) => a.id === xId)!;
    expect(x.change).toBe(x.latest! - 100);
    // 7日間にすると、それより前の記録は含まない
    expect((await analytics.getAnalytics(userId, { brandId, days: 7, now: NOW })).accounts.find((a) => a.id === xId)!.change).toBeNull();
  });

  it("AI 分析：最新の数値を取り、根拠（ref）付きの結果と、AI に渡した実績を保存する", async () => {
    for (let i = 0; i < 4; i++) await publishedPost(`投稿${i}`, i % 2 ? "ラウンジ" : "カフェ", i % 2 ? threadsId : xId, i % 2 ? "THREADS" : "X", daysAgo(i + 1));

    const report = await analysis.startAnalysis(userId, brandId);
    expect(analysisJobs).toEqual([report.id]);
    await expect(analysis.startAnalysis(userId, brandId)).rejects.toMatchObject({ status: 409 });

    await analysis.executeAnalysis(report.id, NOW);
    const done = await analysis.getAnalysisReport(userId, report.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.postCount).toBe(4);
    const evidence = done.evidence as { posts: { ref: string; views: number | null }[] };
    expect(evidence.posts.map((p) => p.ref)).toEqual(["P1", "P2", "P3", "P4"]);
    const result = done.result as { goodThemes: { evidence: string[] }[]; nextIdeas: unknown[] };
    expect(result.nextIdeas).toHaveLength(3);
    for (const ref of result.goodThemes.flatMap((t) => t.evidence)) expect(evidence.posts.map((p) => p.ref)).toContain(ref);
    // AI には実際の数値と集計が渡る
    expect(ai.analyzeCalls[0].posts[0].views).toBe(evidence.posts[0].views);
    expect(ai.analyzeCalls[0].byPillar.length).toBeGreaterThan(0);

    // 他のユーザーからは見えない・分析できない
    await expect(analysis.getAnalysisReport(otherUserId, report.id)).rejects.toMatchObject({ status: 404 });
    await expect(analysis.startAnalysis(otherUserId, brandId)).rejects.toMatchObject({ status: 404 });
  });

  it("数値を取得できた投稿が少ないときは、理由を表示して失敗にする", async () => {
    await publishedPost("1件だけ", "カフェ", xId, "X", daysAgo(1));
    const report = await analysis.startAnalysis(userId, brandId);
    await analysis.executeAnalysis(report.id, NOW);
    const failed = await analysis.getAnalysisReport(userId, report.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toContain("3件以上");
  });

  it("毎週の自動実行では、計画の前に分析し、その結果を計画に反映する", async () => {
    for (let i = 0; i < 3; i++) await publishedPost(`投稿${i}`, "カフェ", xId, "X", daysAgo(i + 1));
    const config = await agent.saveAgentConfig(userId, brandId, {
      weeklyEnabled: true,
      runWeekday: 4,
      runTime: "09:00",
      postsPerWeek: 2,
      preferredWeekdays: [5, 6],
      preferredTime: "12:00",
      targetAccountIds: [xId],
      generateImages: false,
    });
    const runId = await agent.startWeeklyRun(config.id);
    await agent.executeAgentRun(runId!, NOW);

    const reports = await analysis.listAnalysisReports(userId, brandId);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ trigger: "SCHEDULED", status: "COMPLETED" });
    const insights = ai.planCalls[0].insights;
    expect(insights?.nextIdeas).toHaveLength(3);
    const run = await agent.getAgentRun(userId, runId!);
    expect(run.status).toBe("COMPLETED");
    expect(run.posts[0].topic).toBe(insights!.nextIdeas[0].topic);
    expect(run.summary).toContain("分析");
  });

  it("手動の実行では分析し直さず、14日以内の分析があれば参考にする", async () => {
    for (let i = 0; i < 3; i++) await publishedPost(`投稿${i}`, "カフェ", xId, "X", daysAgo(i + 1));
    await agent.saveAgentConfig(userId, brandId, {
      weeklyEnabled: false,
      runWeekday: 1,
      runTime: "09:00",
      postsPerWeek: 1,
      preferredWeekdays: [5],
      preferredTime: "12:00",
      targetAccountIds: [xId],
      generateImages: false,
    });
    const run1 = await agent.startAgentRun(userId, brandId);
    await agent.executeAgentRun(run1.id, NOW);
    expect(ai.planCalls[0].insights).toBeNull();
    expect(await prisma.analysisReport.count({ where: { userId } })).toBe(0);

    const report = await analysis.startAnalysis(userId, brandId);
    await analysis.executeAnalysis(report.id, NOW);
    await prisma.post.deleteMany({ where: { userId, agentRunId: run1.id } });
    const run2 = await agent.startAgentRun(userId, brandId);
    await agent.executeAgentRun(run2.id, NOW);
    expect(ai.planCalls[1].insights?.summary).toBeTruthy();
  });

  it("数値の更新はキューに依頼する", async () => {
    await metricsService.requestMetricsRefresh(userId);
    expect(refreshJobs).toEqual([userId]);
  });

  it("ダッシュボード：今週の投稿・成功・予約・下書き", async () => {
    await publishedPost("今週の投稿", "カフェ", xId, "X", daysAgo(1)); // 10/28(水)
    await publishedPost("先週の投稿", "カフェ", xId, "X", daysAgo(5)); // 10/24(土)
    await prisma.post.create({ data: { userId, brandId, title: "予約", status: "SCHEDULED", scheduledAt: new Date(NOW.getTime() + 86_400_000) } });
    await prisma.post.create({ data: { userId, brandId, title: "下書き", status: "DRAFT" } });
    const stats = await dashboard.getDashboardStats(userId, NOW);
    expect(stats).toMatchObject({ weekPosts: 2, weekPublished: 1, scheduledCount: 1, draftCount: 1 });
  });
});
