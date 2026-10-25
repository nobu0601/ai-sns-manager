import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDatabase } from "../helpers";

// AI Agent と画像生成の統合テスト（AI・画像生成・キューは Mock／記録用に差し替える）
describe.skipIf(!hasTestDatabase)("AI Agent・画像生成（統合）", async () => {
  const { prisma } = await import("@/lib/database/prisma");
  const agent = await import("@/lib/agent/agent-service");
  const media = await import("@/lib/media/media-service");
  const { setAIProvider } = await import("@/lib/ai/registry");
  const { MockAIProvider } = await import("@/lib/ai/mock-provider");
  const { setMediaProvider } = await import("@/lib/media/registry");
  const { MockMediaProvider } = await import("@/lib/media/mock-provider");
  const { MediaGenerationError } = await import("@/lib/media/errors");
  const { setJobDispatcher } = await import("@/lib/queue/jobs");
  const { setPublishScheduler } = await import("@/lib/queue/post-queue");
  const accounts = await import("@/lib/social/account-service");

  const scheduled: string[] = [];
  const mediaJobs: { mediaId: string; brandId?: string | null }[] = [];
  const agentJobs: string[] = [];
  const weekly = new Map<string, string>();
  setPublishScheduler({
    async schedule({ idempotencyKey }) {
      scheduled.push(idempotencyKey);
    },
    async cancel() {},
  });
  setJobDispatcher({
    async enqueueMedia(data) {
      mediaJobs.push(data);
    },
    async enqueueAgentRun(runId) {
      agentJobs.push(runId);
    },
    async upsertWeeklyAgent(configId, weekday, time) {
      weekly.set(configId, `${weekday} ${time}`);
    },
    async removeWeeklyAgent(configId) {
      weekly.delete(configId);
    },
  });

  // 2026-10-26(月) 08:00 JST
  const NOW = new Date("2026-10-25T23:00:00.000Z");
  let userId: string;
  let brandId: string;
  let xId: string;
  let igId: string;
  let ai: InstanceType<typeof MockAIProvider>;
  let mediaProvider: InstanceType<typeof MockMediaProvider>;

  const config = (over: Partial<Parameters<typeof agent.saveAgentConfig>[2]> = {}) => ({
    weeklyEnabled: false,
    runWeekday: 1,
    runTime: "09:00",
    postsPerWeek: 3,
    preferredWeekdays: [1, 3, 5],
    preferredTime: "12:00",
    targetAccountIds: [xId],
    generateImages: false,
    ...over,
  });

  async function runAgent() {
    const run = await agent.startAgentRun(userId, brandId);
    await agent.executeAgentRun(run.id, NOW);
    return agent.getAgentRun(userId, run.id);
  }

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `agent-${randomUUID()}@example.com`, passwordHash: "x" } });
    userId = user.id;
    const brand = await prisma.brand.create({
      data: { userId, name: "Lounge+", contentPillars: ["カフェ", "ラウンジ", "大阪情報"], prohibitedWords: ["激安"] },
    });
    brandId = brand.id;
    xId = (await accounts.connectAccount(userId, "X", { credentials: { apiKey: "k", apiSecret: "s", accessToken: "agent-x-token", accessTokenSecret: "t" } })).id;
    igId = (await accounts.connectAccount(userId, "INSTAGRAM", { credentials: { accessToken: "agent-ig-token" } })).id;
  });

  beforeEach(async () => {
    ai = new MockAIProvider();
    mediaProvider = new MockMediaProvider();
    setAIProvider(ai);
    setMediaProvider(mediaProvider);
    scheduled.length = 0;
    mediaJobs.length = 0;
    agentJobs.length = 0;
    // テストごとに投稿と実行記録を消す（枠の計算に影響するため）
    await prisma.post.deleteMany({ where: { userId } });
    await prisma.agentRun.deleteMany({ where: { userId } });
    await prisma.user.update({ where: { id: userId }, data: { approvalMode: "ALWAYS" } });
  });

  afterEach(() => {
    setAIProvider(null);
    setMediaProvider(null);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("設定の保存で毎週の自動実行を登録・解除する", async () => {
    const saved = await agent.saveAgentConfig(userId, brandId, config({ weeklyEnabled: true, runWeekday: 1, runTime: "09:00" }));
    expect(weekly.get(saved.id)).toBe("1 09:00");
    await agent.saveAgentConfig(userId, brandId, config({ weeklyEnabled: false }));
    expect(weekly.has(saved.id)).toBe(false);
  });

  it("他のユーザーのアカウントは投稿先に設定できない", async () => {
    await expect(agent.saveAgentConfig(userId, brandId, config({ targetAccountIds: ["other-account"] }))).rejects.toMatchObject({ status: 404 });
  });

  it("今後7日間の投稿を計画：設定した曜日・時刻に、柱が偏らないテーマで、承認待ちの投稿を作る", async () => {
    await agent.saveAgentConfig(userId, brandId, config());
    const run = await runAgent();
    expect(agentJobs).toHaveLength(1);
    expect(run.status).toBe("COMPLETED");
    expect(run.posts).toHaveLength(3);
    expect(run.posts.map((p) => p.scheduledAt?.toISOString())).toEqual([
      "2026-10-26T03:00:00.000Z",
      "2026-10-28T03:00:00.000Z",
      "2026-10-30T03:00:00.000Z",
    ]);
    expect(new Set(run.posts.map((p) => p.contentPillar))).toEqual(new Set(["カフェ", "ラウンジ", "大阪情報"]));
    for (const post of run.posts) {
      expect(post.aiGenerated).toBe(true);
      expect(post.approvalStatus).toBe("PENDING");
      expect(post.status).toBe("READY");
    }
    expect(run.summary).toContain("3件");
    expect(Array.isArray(run.plan)).toBe(true);
    // AI には投稿枠・ブランド・履歴が渡る
    expect(ai.planCalls[0].slots.map((s) => s.label)).toEqual(["10/26(月) 12:00", "10/28(水) 12:00", "10/30(金) 12:00"]);
    expect(ai.planCalls[0].brand.contentPillars).toEqual(["カフェ", "ラウンジ", "大阪情報"]);
    expect(scheduled).toHaveLength(0);

    // まとめて承認すると、計画した日時で予約される
    const results = await agent.approveAgentRun(userId, run.id);
    expect(results.every((r) => r.ok)).toBe(true);
    const after = await agent.getAgentRun(userId, run.id);
    expect(after.posts.every((p) => p.status === "SCHEDULED" && p.approvalStatus === "APPROVED")).toBe(true);
    expect(after.posts.map((p) => p.scheduledAt?.toISOString())).toEqual(run.posts.map((p) => p.scheduledAt?.toISOString()));
  });

  it("2回目の実行では、予定がある日を避けて計画し、履歴を AI に渡す", async () => {
    await agent.saveAgentConfig(userId, brandId, config({ postsPerWeek: 2 }));
    await runAgent();
    const second = await runAgent();
    expect(second.posts).toHaveLength(2);
    const firstDays = new Set(["2026-10-26", "2026-10-28"]);
    expect(second.posts.some((p) => firstDays.has(p.scheduledAt!.toISOString().slice(0, 10)))).toBe(false);
    expect(ai.planCalls[1].history.length).toBeGreaterThanOrEqual(2);
  });

  it("完全自動モードでは承認なしで予約する", async () => {
    await prisma.user.update({ where: { id: userId }, data: { approvalMode: "AUTO" } });
    await agent.saveAgentConfig(userId, brandId, config({ postsPerWeek: 2 }));
    const run = await runAgent();
    expect(run.posts.every((p) => p.status === "SCHEDULED" && p.approvalStatus === "NOT_REQUIRED")).toBe(true);
    expect(scheduled).toHaveLength(2);
    expect(run.summary).toContain("完全自動");
  });

  it("Instagram が投稿先なら画像を生成し、できあがると添付する（完全自動ならその後に予約）", async () => {
    await prisma.user.update({ where: { id: userId }, data: { approvalMode: "AUTO" } });
    await agent.saveAgentConfig(userId, brandId, config({ postsPerWeek: 1, targetAccountIds: [xId, igId] }));
    const run = await runAgent();
    expect(run.posts).toHaveLength(1);
    expect(run.posts[0].status).toBe("READY"); // 画像待ち
    expect(mediaJobs).toHaveLength(1);

    const result = await media.processMedia(mediaJobs[0].mediaId, { brandId: mediaJobs[0].brandId, attempt: 1, maxAttempts: 2 });
    expect(result.outcome).toBe("ready");
    expect(mediaProvider.calls[0]).toMatchObject({ type: "IMAGE" });
    const generated = await prisma.media.findUniqueOrThrow({ where: { id: mediaJobs[0].mediaId } });
    expect(generated.status).toBe("READY");
    expect(generated.prompt).toContain("no text");
    expect(generated.aspectRatio).toBe("4:5");

    const post = await prisma.post.findUniqueOrThrow({ where: { id: run.posts[0].id }, include: { platforms: true } });
    for (const p of post.platforms) {
      expect(p.mediaUrls).toEqual([generated.url]);
      expect(p.mediaType).toBe("IMAGE");
    }
    expect(post.status).toBe("SCHEDULED");
  });

  it("柱が偏った計画は作り直させ、直らなければ失敗として記録する", async () => {
    await agent.saveAgentConfig(userId, brandId, config());
    Object.assign(ai, {
      async planWeek(req: { slots: { index: number }[] }) {
        return { model: "mock", items: req.slots.map((s) => ({ slotIndex: s.index, pillar: "カフェ", topic: "t", style: "story", reason: "r", imageIdea: "i" })) };
      },
    });
    const run = await runAgent();
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toContain("偏って");
    expect(run.posts).toHaveLength(0);
  });

  it("設定が無い・実行中なら開始できない", async () => {
    const other = await prisma.brand.create({ data: { userId, name: "別ブランド" } });
    await expect(agent.startAgentRun(userId, other.id)).rejects.toMatchObject({ code: "AGENT_NOT_CONFIGURED" });
    await agent.saveAgentConfig(userId, brandId, config());
    await agent.startAgentRun(userId, brandId);
    await expect(agent.startAgentRun(userId, brandId)).rejects.toMatchObject({ code: "AGENT_RUNNING" });
  });

  it("画像生成：依頼 → AI がプロンプトを作る → 生成 → 完成", async () => {
    const m = await media.requestMedia(userId, { type: "IMAGE", idea: "窓際で仕事をする様子", aspectRatio: "1:1", brandId });
    expect(m.status).toBe("PENDING");
    expect(mediaJobs[0]).toEqual({ mediaId: m.id, brandId });
    await media.processMedia(m.id, { brandId, attempt: 1, maxAttempts: 2 });
    const done = await media.getMedia(userId, m.id);
    expect(done.status).toBe("READY");
    expect(done.url).toMatch(/^https:\/\//);
    await expect(media.getMedia("other-user", m.id)).rejects.toMatchObject({ status: 404 });
  });

  it("動画生成：AI が構成メモも作る", async () => {
    const m = await media.requestMedia(userId, { type: "VIDEO", idea: "コーヒーを淹れる手元", aspectRatio: "9:16" });
    await media.processMedia(m.id, { attempt: 1, maxAttempts: 2 });
    const done = await media.getMedia(userId, m.id);
    expect(done.status).toBe("READY");
    expect(done.script).toContain("0〜3秒");
    expect(mediaProvider.calls[0].type).toBe("VIDEO");
  });

  it("生成サービスのエラー：一時的なものは再試行、キー不正などは分かりやすい文で失敗", async () => {
    const m = await media.requestMedia(userId, { type: "IMAGE", idea: "x", aspectRatio: "1:1" });
    Object.assign(mediaProvider, {
      async generateImage() {
        throw new MediaGenerationError("RATE_LIMIT");
      },
    });
    expect(await media.processMedia(m.id, { attempt: 1, maxAttempts: 2 })).toMatchObject({ outcome: "failed", retryable: true });
    expect((await media.getMedia(userId, m.id)).status).toBe("PENDING");
    Object.assign(mediaProvider, {
      async generateImage() {
        throw new MediaGenerationError("AUTH", "401");
      },
    });
    expect(await media.processMedia(m.id, { attempt: 2, maxAttempts: 2 })).toMatchObject({ outcome: "failed", retryable: false });
    const failed = await media.getMedia(userId, m.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toContain("FAL_KEY");
  });
});
