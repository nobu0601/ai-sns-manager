import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasTestDatabase } from "../helpers";

// TikTok の連携と投稿（SNS は Mock。トークンの更新は TikTok の代わりに偽の応答を返す）
describe.skipIf(!hasTestDatabase)("TikTok（統合）", async () => {
  const { prisma } = await import("@/lib/database/prisma");
  const { setPublishScheduler } = await import("@/lib/queue/post-queue");
  const { setJobDispatcher } = await import("@/lib/queue/jobs");
  const posts = await import("@/lib/posts/post-service");
  const { publishPostPlatform } = await import("@/lib/posts/publish-service");
  const accounts = await import("@/lib/social/account-service");
  const agent = await import("@/lib/agent/agent-service");
  const { connectMockTikTok } = await import("@/lib/social/tiktok/tiktok-connect");
  const { encrypt, decrypt } = await import("@/lib/encryption/crypto");

  setPublishScheduler({ async schedule() {}, async cancel() {} });
  setJobDispatcher({
    async enqueueMedia() {},
    async enqueueAgentRun() {},
    async upsertWeeklyAgent() {},
    async removeWeeklyAgent() {},
    async enqueueMetricsRefresh() {},
    async enqueueAnalysis() {},
  });

  let userId: string;
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `tiktok-${randomUUID()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("Mock では TikTok に問い合わせずに連携でき、動画を付けた投稿を投稿できる（画像は不可）", async () => {
    const result = await connectMockTikTok(userId);
    expect(result.ok).toBe(true);
    const account = await prisma.socialAccount.findFirstOrThrow({ where: { userId, platform: "TIKTOK" } });
    expect(account.credentialHint).toBe("TikTokログイン");

    const image = await posts.createPost(userId, {
      title: "画像",
      topic: "",
      targets: [{ socialAccountId: account.id, content: "画像", mediaUrls: ["https://cdn.example/a.jpg"], mediaType: "IMAGE" }],
    });
    await expect(posts.schedulePost(userId, image.id, { scheduledAt: new Date(Date.now() + 3600_000), approve: true })).rejects.toMatchObject({
      status: 400,
    });
    const post = await posts.createPost(userId, {
      title: "動画",
      topic: "",
      targets: [{ socialAccountId: account.id, content: "週末の過ごし方 #大阪", mediaUrls: ["https://cdn.example/v.mp4"], mediaType: "VIDEO" }],
    });
    await posts.schedulePost(userId, post.id, { scheduledAt: new Date(Date.now() + 3600_000), approve: true });
    const pp = await prisma.postPlatform.findFirstOrThrow({ where: { postId: post.id } });
    expect(await publishPostPlatform(pp.id, { attempt: 1, maxAttempts: 3 })).toMatchObject({ outcome: "published" });
  });

  it("AI エージェントの投稿先に TikTok は選べない", async () => {
    const brand = await prisma.brand.create({ data: { userId, name: "Lounge+" } });
    const tiktok = await prisma.socialAccount.findFirstOrThrow({ where: { userId, platform: "TIKTOK" } });
    await expect(
      agent.saveAgentConfig(userId, brand.id, {
        weeklyEnabled: false,
        runWeekday: 1,
        runTime: "09:00",
        postsPerWeek: 1,
        preferredWeekdays: [1],
        preferredTime: "12:00",
        targetAccountIds: [tiktok.id],
        generateImages: false,
      }),
    ).rejects.toMatchObject({ code: "AGENT_UNSUPPORTED_PLATFORM" });
  });

  it("本番（live）では、期限が近いトークンを使う前に更新して保存する", async () => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", "ck");
    vi.stubEnv("TIKTOK_CLIENT_SECRET", "cs");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "new-a", refresh_token: "new-r", open_id: "o1", expires_in: 86400, refresh_expires_in: 31536000 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const soon = new Date(Date.now() + 60_000).toISOString();
    const account = await prisma.socialAccount.create({
      data: {
        userId,
        platform: "TIKTOK",
        externalAccountId: `o1-${randomUUID()}`,
        accountName: "@live",
        isMock: false,
        credentialsEncrypted: encrypt(JSON.stringify({ accessToken: "old-a", refreshToken: "old-r", openId: "o1", accessTokenExpiresAt: soon, refreshTokenExpiresAt: soon })),
      },
    });
    const creds = (await accounts.freshCredentials(account)) as unknown as { accessToken: string; refreshToken: string };
    expect(creds).toMatchObject({ accessToken: "new-a", refreshToken: "new-r" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(decrypt((await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } })).credentialsEncrypted));
    expect(saved.accessToken).toBe("new-a");
  });
});
