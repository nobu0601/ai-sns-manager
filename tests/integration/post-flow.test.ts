import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDatabase } from "../helpers";

// DB を使う統合テスト：投稿作成 → 承認 → 予約 → Worker 相当の投稿処理 → 結果・ログ
describe.skipIf(!hasTestDatabase)("投稿フロー（統合）", async () => {
  const { prisma } = await import("@/lib/database/prisma");
  const { setPublishScheduler } = await import("@/lib/queue/post-queue");
  const posts = await import("@/lib/posts/post-service");
  const { publishPostPlatform } = await import("@/lib/posts/publish-service");
  const accounts = await import("@/lib/social/account-service");
  const { MOCK_TRIGGERS } = await import("@/lib/social/mock/mock-adapter");
  const { decrypt } = await import("@/lib/encryption/crypto");

  // キューの代わりに登録内容を記録する
  const scheduled = new Map<string, { postPlatformId: string; runAt: Date }>();
  const cancelled: string[] = [];
  setPublishScheduler({
    async schedule({ postPlatformId, idempotencyKey, runAt }) {
      scheduled.set(idempotencyKey, { postPlatformId, runAt });
    },
    async cancel(key) {
      cancelled.push(key);
      scheduled.delete(key);
    },
  });

  let userId: string;
  const future = () => new Date(Date.now() + 60 * 60 * 1000);

  async function connect(platform: "X" | "INSTAGRAM" | "THREADS") {
    const url = new URL(await accounts.startConnect(userId, platform, `http://localhost:3000/api/social/${platform.toLowerCase()}/callback`));
    return accounts.completeConnect({
      userId,
      platform,
      state: url.searchParams.get("state")!,
      code: url.searchParams.get("code")!,
      redirectUri: "http://localhost:3000/cb",
    });
  }

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `it-${randomUUID()}@example.com`, passwordHash: "x" } });
    userId = user.id;
    await connect("X");
    await connect("THREADS");
  });

  beforeEach(() => {
    scheduled.clear();
    cancelled.length = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("SNSアカウント接続：トークンは暗号化して保存され、一覧には含まれない", async () => {
    const row = await prisma.socialAccount.findFirstOrThrow({ where: { userId, platform: "X" } });
    expect(row.accessTokenEncrypted).not.toMatch(/^mock-access-/);
    expect(decrypt(row.accessTokenEncrypted)).toMatch(/^mock-access-/);
    const list = await accounts.listAccounts(userId);
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain("Encrypted");
  });

  it("OAuth の state は使い回せない", async () => {
    const url = new URL(await accounts.startConnect(userId, "X", "http://localhost:3000/cb"));
    const input = { userId, platform: "X" as const, state: url.searchParams.get("state")!, code: "mock-code-x", redirectUri: "x" };
    await accounts.completeConnect(input);
    await expect(accounts.completeConnect(input)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("作成 → 承認待ちでは予約不可 → 承認付き予約 → 投稿成功", async () => {
    const post = await posts.createPost(userId, {
      title: "Lounge+紹介",
      topic: "ブランド紹介",
      platforms: [
        { platform: "X", content: "大阪で仕事と休憩を。" },
        { platform: "THREADS", content: "Lounge+ に来てみませんか？" },
      ],
    });
    expect(post.status).toBe("READY");
    expect(post.approvalStatus).toBe("PENDING");
    expect(post.platforms.map((p) => p.idempotencyKey)).toEqual([`${post.id}:X`, `${post.id}:THREADS`]);

    await expect(posts.schedulePost(userId, post.id, { scheduledAt: future() })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });

    const runAt = future();
    const s = await posts.schedulePost(userId, post.id, { scheduledAt: runAt, approve: true });
    expect(s.status).toBe("SCHEDULED");
    expect(s.approvalStatus).toBe("APPROVED");
    expect(scheduled.size).toBe(2);
    expect(scheduled.get(`${post.id}:X`)!.runAt.getTime()).toBe(runAt.getTime());

    for (const { postPlatformId } of scheduled.values()) {
      expect(await publishPostPlatform(postPlatformId, { attempt: 1, maxAttempts: 3 })).toMatchObject({ outcome: "published" });
    }
    const done = await posts.getPost(userId, post.id);
    expect(done.status).toBe("PUBLISHED");
    expect(done.platforms.every((p) => p.externalPostId && p.publishedAt)).toBe(true);
    const events = done.platforms[0].logs.map((l) => l.event);
    expect(events).toEqual(expect.arrayContaining(["POST_CREATED", "APPROVED", "SCHEDULED", "POST_STARTED", "POST_SUCCESS"]));
  });

  it("二重投稿防止：投稿済みの同じジョブは再実行してもスキップされる", async () => {
    const post = await posts.createPost(userId, { title: "t", topic: "", platforms: [{ platform: "X", content: "一度だけ" }] });
    await posts.schedulePost(userId, post.id, { scheduledAt: new Date(), approve: true });
    const id = scheduled.get(`${post.id}:X`)!.postPlatformId;
    const first = await publishPostPlatform(id, { attempt: 1, maxAttempts: 3 });
    const second = await publishPostPlatform(id, { attempt: 1, maxAttempts: 3 });
    expect(first.outcome).toBe("published");
    expect(second).toMatchObject({ outcome: "skipped" });
    const successLogs = await prisma.postLog.count({ where: { postPlatformId: id, event: "POST_SUCCESS" } });
    expect(successLogs).toBe(1);
  });

  it("一時的なエラーはリトライし、上限で失敗になる", async () => {
    const post = await posts.createPost(userId, {
      title: "t",
      topic: "",
      platforms: [{ platform: "X", content: `retry ${MOCK_TRIGGERS.transientError}` }],
    });
    await posts.schedulePost(userId, post.id, { scheduledAt: new Date(), approve: true });
    const id = scheduled.get(`${post.id}:X`)!.postPlatformId;

    expect(await publishPostPlatform(id, { attempt: 1, maxAttempts: 3 })).toMatchObject({ outcome: "failed", retryable: true });
    expect((await prisma.postPlatform.findUniqueOrThrow({ where: { id } })).status).toBe("SCHEDULED");
    await publishPostPlatform(id, { attempt: 2, maxAttempts: 3 });
    expect(await publishPostPlatform(id, { attempt: 3, maxAttempts: 3 })).toMatchObject({ outcome: "failed", retryable: false });

    const row = await prisma.postPlatform.findUniqueOrThrow({ where: { id }, include: { logs: true } });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(3);
    // 最終失敗では「自動で再試行します」と表示しない
    expect(row.errorMessage).toContain("つながらず");
    expect(row.errorMessage).not.toContain("自動で再試行");
    expect(row.logs.filter((l) => l.event === "RETRY")).toHaveLength(2);
    expect(row.logs.filter((l) => l.event === "POST_FAILED")).toHaveLength(1);
  });

  it("内容エラーはリトライせず即失敗。認証エラーならアカウントを再認証必要にする", async () => {
    const post = await posts.createPost(userId, {
      title: "t",
      topic: "",
      platforms: [
        { platform: "X", content: `bad ${MOCK_TRIGGERS.contentError}` },
        { platform: "THREADS", content: `auth ${MOCK_TRIGGERS.authError}` },
      ],
    });
    await posts.schedulePost(userId, post.id, { scheduledAt: new Date(), approve: true });
    const x = await publishPostPlatform(scheduled.get(`${post.id}:X`)!.postPlatformId, { attempt: 1, maxAttempts: 3 });
    const th = await publishPostPlatform(scheduled.get(`${post.id}:THREADS`)!.postPlatformId, { attempt: 1, maxAttempts: 3 });
    expect(x).toMatchObject({ outcome: "failed", retryable: false, kind: "CONTENT" });
    expect(th).toMatchObject({ outcome: "failed", retryable: false, kind: "AUTH" });

    const detail = await posts.getPost(userId, post.id);
    expect(detail.status).toBe("FAILED");
    expect(detail.platforms.find((p) => p.platform === "THREADS")!.errorMessage).toContain("再接続");
    // 元のエラーは詳細ログにのみ残る
    const failLog = detail.platforms.find((p) => p.platform === "THREADS")!.logs.find((l) => l.event === "POST_FAILED");
    expect(JSON.stringify(failLog!.metadata)).toContain("code 190");
    const threads = await prisma.socialAccount.findFirstOrThrow({ where: { userId, platform: "THREADS" } });
    expect(threads.status).toBe("EXPIRED");

    // 後続テストのため接続し直す
    await connect("THREADS");
  });

  it("未接続のSNSや文字数超過は予約できない", async () => {
    const post = await posts.createPost(userId, {
      title: "t",
      topic: "",
      platforms: [
        { platform: "INSTAGRAM", content: "未接続" },
        { platform: "X", content: "あ".repeat(281) },
      ],
    });
    const err = await posts.schedulePost(userId, post.id, { scheduledAt: future(), approve: true }).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details.join()).toContain("Instagramのアカウントが接続されていません");
    expect(err.details.join()).toContain("280文字以内");
    expect(scheduled.size).toBe(0);
  });

  it("過去日時は予約できない", async () => {
    const post = await posts.createPost(userId, { title: "t", topic: "", platforms: [{ platform: "X", content: "a" }] });
    await expect(
      posts.schedulePost(userId, post.id, { scheduledAt: new Date(Date.now() - 10 * 60 * 1000), approve: true }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
  });

  it("予約後に編集すると予約が解除され、承認もやり直しになる", async () => {
    const post = await posts.createPost(userId, { title: "t", topic: "", platforms: [{ platform: "X", content: "a" }] });
    await posts.schedulePost(userId, post.id, { scheduledAt: future(), approve: true });
    const edited = await posts.updatePost(userId, post.id, {
      title: "t2",
      topic: "",
      platforms: [
        { platform: "X", content: "b" },
        { platform: "THREADS", content: "c" },
      ],
    });
    expect(cancelled).toContain(`${post.id}:X`);
    expect(edited.status).toBe("READY");
    expect(edited.approvalStatus).toBe("PENDING");
    expect(edited.scheduledAt).toBeNull();
    expect(edited.platforms.map((p) => p.platform)).toEqual(["X", "THREADS"]);
  });

  it("予約取消・却下・削除", async () => {
    const post = await posts.createPost(userId, { title: "t", topic: "", platforms: [{ platform: "X", content: "a" }] });
    await posts.schedulePost(userId, post.id, { scheduledAt: future(), approve: true });
    expect((await posts.cancelSchedule(userId, post.id)).status).toBe("READY");

    const rejected = await posts.rejectPost(userId, post.id);
    expect(rejected.approvalStatus).toBe("REJECTED");
    await expect(posts.schedulePost(userId, post.id, { scheduledAt: future() })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });

    await posts.deletePost(userId, post.id);
    await expect(posts.getPost(userId, post.id)).rejects.toMatchObject({ status: 404 });
  });

  it("他のユーザーの投稿は操作できない", async () => {
    const post = await posts.createPost(userId, { title: "t", topic: "", platforms: [{ platform: "X", content: "a" }] });
    await expect(posts.getPost("other-user", post.id)).rejects.toMatchObject({ status: 404 });
    await expect(posts.deletePost("other-user", post.id)).rejects.toMatchObject({ status: 404 });
  });

  it("承認モード「完全自動」では承認不要で予約できる", async () => {
    await prisma.user.update({ where: { id: userId }, data: { approvalMode: "AUTO" } });
    try {
      const post = await posts.createPost(userId, { title: "t", topic: "", platforms: [{ platform: "X", content: "a" }] });
      expect(post.approvalStatus).toBe("NOT_REQUIRED");
      expect((await posts.schedulePost(userId, post.id, { scheduledAt: future() })).status).toBe("SCHEDULED");
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { approvalMode: "ALWAYS" } });
    }
  });
});
