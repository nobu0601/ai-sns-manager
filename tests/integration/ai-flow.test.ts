import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { hasTestDatabase } from "../helpers";

// AI 投稿生成の統合テスト：ブランド情報 → 5案生成 → 品質チェックと作り直し → 採用して投稿作成 → 承認・予約
describe.skipIf(!hasTestDatabase)("AI投稿生成（統合）", async () => {
  const { prisma } = await import("@/lib/database/prisma");
  const { generateDrafts, MAX_REGENERATIONS } = await import("@/lib/ai/ai-service");
  const { setAIProvider } = await import("@/lib/ai/registry");
  const { MockAIProvider, MOCK_AI_PROHIBITED_TRIGGER } = await import("@/lib/ai/mock-provider");
  const { DRAFT_STYLES } = await import("@/lib/ai/types");
  const posts = await import("@/lib/posts/post-service");
  const accounts = await import("@/lib/social/account-service");
  const { setPublishScheduler } = await import("@/lib/queue/post-queue");

  setPublishScheduler({ async schedule() {}, async cancel() {} });

  let userId: string;
  let brandId: string;
  let xId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `ai-${randomUUID()}@example.com`, passwordHash: "x" } });
    userId = user.id;
    const brand = await prisma.brand.create({
      data: { userId, name: "Lounge+", tone: "落ち着いた", prohibitedWords: ["激安"], keywords: ["大阪"] },
    });
    brandId = brand.id;
    xId = (
      await accounts.connectAccount(userId, "X", {
        credentials: { apiKey: "k", apiSecret: "s", accessToken: "ai-test-token", accessTokenSecret: "t" },
      })
    ).id;
  });

  afterEach(() => setAIProvider(null));

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("5つの型の案を作り、ブランド情報を AI に渡す", async () => {
    const mock = new MockAIProvider();
    setAIProvider(mock);
    const result = await generateDrafts(userId, { topic: "週末の過ごし方", brandId });
    expect(result.drafts.map((d) => d.style)).toEqual([...DRAFT_STYLES]);
    expect(result.drafts.every((d) => d.id && d.errors.length === 0)).toBe(true);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].brand?.name).toBe("Lounge+");
    expect(mock.calls[0].brand?.prohibitedWords).toEqual(["激安"]);
  });

  it("禁止キーワードが入った案だけ、問題点を伝えて作り直させる", async () => {
    const mock = new MockAIProvider();
    setAIProvider(mock);
    const result = await generateDrafts(userId, { topic: `週末 ${MOCK_AI_PROHIBITED_TRIGGER}`, brandId });
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[1].styles).toEqual(["brand_intro"]);
    expect(mock.calls[1].feedback?.[0].issues.join()).toContain("禁止キーワード「激安」");
    expect(result.drafts).toHaveLength(5);
    expect(result.drafts.every((d) => d.errors.length === 0)).toBe(true);
  });

  it("直らない場合は作り直しの上限で止め、問題を案に付けて返す", async () => {
    const calls: unknown[] = [];
    // 文章が長すぎる案を返し続ける AI（それ以外の機能は Mock のまま）
    const tooLong = new MockAIProvider();
    setAIProvider(tooLong);
    Object.assign(tooLong, {
      async generate(req: import("@/lib/ai/types").GenerateRequest) {
        calls.push(req);
        return {
          model: "test",
          drafts: req.styles.map((style) => ({
            style,
            title: "t",
            summary: "s",
            x: { text: "あ".repeat(200) },
            instagram: { caption: "c", hashtags: [] },
            threads: { text: `t-${style}` },
            tiktok: { text: `k-${style}` },
          })),
        };
      },
    });
    const result = await generateDrafts(userId, { topic: "x", brandId, styles: ["story"] });
    expect(calls).toHaveLength(1 + MAX_REGENERATIONS);
    expect(result.drafts[0].errors.join()).toContain("Xの文章が長すぎます");
  });

  it("1つの型だけ作り直せる（この案を再生成）", async () => {
    setAIProvider(new MockAIProvider());
    const result = await generateDrafts(userId, { topic: "週末", brandId, styles: ["question"] });
    expect(result.drafts.map((d) => d.style)).toEqual(["question"]);
  });

  it("他のユーザーのブランドは使えない", async () => {
    setAIProvider(new MockAIProvider());
    await expect(generateDrafts("other-user", { topic: "x", brandId })).rejects.toMatchObject({ status: 404 });
  });

  it("AI の案を採用した投稿は記録され、「AI生成後のみ承認」モードでは承認待ちになる", async () => {
    await prisma.user.update({ where: { id: userId }, data: { approvalMode: "AI_ONLY" } });
    try {
      const manual = await posts.createPost(userId, { title: "手動", topic: "", targets: [{ socialAccountId: xId, content: "a", mediaUrls: [] }] });
      expect(manual.approvalStatus).toBe("NOT_REQUIRED");

      const ai = await posts.createPost(userId, {
        title: "AI",
        topic: "週末",
        brandId,
        aiGenerated: { model: "claude-sonnet-5-5", style: "story" },
        targets: [{ socialAccountId: xId, content: "週末は読書の時間に。", mediaUrls: [] }],
      });
      expect(ai.aiGenerated).toBe(true);
      expect(ai.approvalStatus).toBe("PENDING");
      const logs = await prisma.postLog.findMany({ where: { postPlatformId: ai.platforms[0].id, event: "AI_GENERATED" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toMatchObject({ model: "claude-sonnet-5-5", style: "story" });

      // 承認するまで予約できない → 承認すれば予約できる
      await expect(posts.schedulePost(userId, ai.id, { scheduledAt: new Date(Date.now() + 3600_000) })).rejects.toMatchObject({
        code: "APPROVAL_REQUIRED",
      });
      expect((await posts.schedulePost(userId, ai.id, { scheduledAt: new Date(Date.now() + 3600_000), approve: true })).status).toBe(
        "SCHEDULED",
      );
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { approvalMode: "ALWAYS" } });
    }
  });

  it("ブランドの禁止キーワードを含む投稿は予約できない（手で編集した場合も）", async () => {
    const post = await posts.createPost(userId, {
      title: "t",
      topic: "",
      brandId,
      targets: [{ socialAccountId: xId, content: "本日激安セール", mediaUrls: [] }],
    });
    const err = await posts.schedulePost(userId, post.id, { scheduledAt: new Date(Date.now() + 3600_000), approve: true }).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details.join()).toContain("禁止キーワード「激安」");
  });
});
