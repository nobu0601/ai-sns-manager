import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDatabase } from "../helpers";

// DB を使う統合テスト：APIキーでアカウント連携 → 投稿作成 → 承認 → 予約 → Worker 相当の投稿処理 → 結果・ログ
describe.skipIf(!hasTestDatabase)("投稿フロー（統合）", async () => {
  const { prisma } = await import("@/lib/database/prisma");
  const { setPublishScheduler } = await import("@/lib/queue/post-queue");
  const posts = await import("@/lib/posts/post-service");
  const { publishPostPlatform } = await import("@/lib/posts/publish-service");
  const accounts = await import("@/lib/social/account-service");
  const { MOCK_INVALID_KEY, MOCK_TRIGGERS } = await import("@/lib/social/mock/mock-adapter");
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
  let xA: string; // X のアカウントA
  let xB: string; // X のアカウントB（同じSNSの2つ目）
  let threads: string;
  const future = () => new Date(Date.now() + 60 * 60 * 1000);
  const xKeys = (seed: string) => ({ apiKey: `ck-${seed}`, apiSecret: "cs", accessToken: `access-${seed}`, accessTokenSecret: "ats" });
  const jobOf = (postId: string, accountId: string) => scheduled.get(`${postId}:${accountId}`)!.postPlatformId;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `it-${randomUUID()}@example.com`, passwordHash: "x" } });
    userId = user.id;
    xA = (await accounts.connectAccount(userId, "X", { credentials: xKeys("a"), label: "店舗A" })).id;
    xB = (await accounts.connectAccount(userId, "X", { credentials: xKeys("b"), label: "店舗B" })).id;
    threads = (await accounts.connectAccount(userId, "THREADS", { credentials: { accessToken: "threads-token" } })).id;
  });

  beforeEach(() => {
    scheduled.clear();
    cancelled.length = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("APIキーによるアカウント連携", () => {
    it("同じSNSに複数のアカウントを登録できる", async () => {
      const list = await accounts.listAccounts(userId);
      expect(list.filter((a) => a.platform === "X").map((a) => a.label)).toEqual(["店舗A", "店舗B"]);
      expect(list).toHaveLength(3);
    });

    it("キーは暗号化して保存され、一覧には末尾4文字しか出ない", async () => {
      const row = await prisma.socialAccount.findUniqueOrThrow({ where: { id: xA } });
      expect(row.credentialsEncrypted).not.toContain("access-a");
      expect(JSON.parse(decrypt(row.credentialsEncrypted))).toEqual(xKeys("a"));
      expect(row.credentialHint).toBe("••••ss-a");
      const list = JSON.stringify(await accounts.listAccounts(userId));
      expect(list).not.toContain("Encrypted");
      expect(list).not.toContain("ck-a");
    });

    it("必須のキーが足りないと 400、無効なキーは確認で 400", async () => {
      await expect(accounts.connectAccount(userId, "X", { credentials: { apiKey: "only" } })).rejects.toMatchObject({
        status: 400,
        code: "VALIDATION_ERROR",
      });
      await expect(
        accounts.connectAccount(userId, "THREADS", { credentials: { accessToken: `bad-${MOCK_INVALID_KEY}` } }),
      ).rejects.toMatchObject({ status: 400, code: "INVALID_CREDENTIALS" });
    });

    it("同じキーをもう一度登録すると、新しく増えずに更新される", async () => {
      await accounts.connectAccount(userId, "X", { credentials: xKeys("a"), label: "店舗A（更新）" });
      const list = await accounts.listAccounts(userId);
      expect(list.filter((a) => a.platform === "X")).toHaveLength(2);
      expect(list.find((a) => a.id === xA)!.label).toBe("店舗A（更新）");
    });

    it("キーの差し替えで別アカウントのキーは拒否される", async () => {
      await expect(accounts.updateAccount(userId, xA, { credentials: xKeys("zzz") })).rejects.toMatchObject({
        code: "ACCOUNT_MISMATCH",
      });
    });

    it("他のユーザーのアカウントは操作できない", async () => {
      await expect(accounts.disconnectAccount("other-user", xA)).rejects.toMatchObject({ status: 404 });
      await expect(accounts.recheckAccount("other-user", xA)).rejects.toMatchObject({ status: 404 });
    });
  });

  it("同じSNSの2アカウント＋Threadsに投稿：承認 → 予約 → 全て投稿成功", async () => {
    const post = await posts.createPost(userId, {
      title: "Lounge+紹介",
      topic: "ブランド紹介",
      targets: [
        { socialAccountId: xA, content: "店舗Aからのお知らせ", mediaUrls: [] },
        { socialAccountId: xB, content: "店舗Bからのお知らせ", mediaUrls: [] },
        { socialAccountId: threads, content: "Lounge+ に来てみませんか？", mediaUrls: [] },
      ],
    });
    expect(post.status).toBe("READY");
    expect(post.approvalStatus).toBe("PENDING");
    expect(post.platforms.map((p) => p.idempotencyKey).sort()).toEqual(
      [`${post.id}:${xA}`, `${post.id}:${xB}`, `${post.id}:${threads}`].sort(),
    );
    expect(post.platforms.filter((p) => p.platform === "X").map((p) => p.content).sort()).toEqual([
      "店舗Aからのお知らせ",
      "店舗Bからのお知らせ",
    ]);

    await expect(posts.schedulePost(userId, post.id, { scheduledAt: future() })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const s = await posts.schedulePost(userId, post.id, { scheduledAt: future(), approve: true });
    expect(s.status).toBe("SCHEDULED");
    expect(scheduled.size).toBe(3);

    for (const { postPlatformId } of scheduled.values()) {
      expect(await publishPostPlatform(postPlatformId, { attempt: 1, maxAttempts: 3 })).toMatchObject({ outcome: "published" });
    }
    const done = await posts.getPost(userId, post.id);
    expect(done.status).toBe("PUBLISHED");
    expect(done.platforms.every((p) => p.externalPostId && p.publishedAt && p.accountName)).toBe(true);
    const events = done.platforms[0].logs.map((l) => l.event);
    expect(events).toEqual(expect.arrayContaining(["POST_CREATED", "APPROVED", "SCHEDULED", "POST_STARTED", "POST_SUCCESS"]));
  });

  it("二重投稿防止：投稿済みの同じジョブは再実行してもスキップされる", async () => {
    const post = await posts.createPost(userId, { title: "t", topic: "", targets: [{ socialAccountId: xA, content: "一度だけ", mediaUrls: [] }] });
    await posts.schedulePost(userId, post.id, { scheduledAt: new Date(), approve: true });
    const id = jobOf(post.id, xA);
    expect((await publishPostPlatform(id, { attempt: 1, maxAttempts: 3 })).outcome).toBe("published");
    expect(await publishPostPlatform(id, { attempt: 1, maxAttempts: 3 })).toMatchObject({ outcome: "skipped" });
    expect(await prisma.postLog.count({ where: { postPlatformId: id, event: "POST_SUCCESS" } })).toBe(1);
  });

  it("一時的なエラーはリトライし、上限で失敗になる", async () => {
    const post = await posts.createPost(userId, {
      title: "t",
      topic: "",
      targets: [{ socialAccountId: xA, content: `retry ${MOCK_TRIGGERS.transientError}`, mediaUrls: [] }],
    });
    await posts.schedulePost(userId, post.id, { scheduledAt: new Date(), approve: true });
    const id = jobOf(post.id, xA);

    expect(await publishPostPlatform(id, { attempt: 1, maxAttempts: 3 })).toMatchObject({ outcome: "failed", retryable: true });
    const retrying = await prisma.postPlatform.findUniqueOrThrow({ where: { id } });
    expect(retrying.status).toBe("SCHEDULED");
    expect(retrying.errorMessage).toContain("自動で再試行");
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

  it("内容エラーはリトライせず即失敗。認証エラーならそのアカウントだけ再認証が必要になる", async () => {
    const post = await posts.createPost(userId, {
      title: "t",
      topic: "",
      targets: [
        { socialAccountId: xA, content: `bad ${MOCK_TRIGGERS.contentError}`, mediaUrls: [] },
        { socialAccountId: xB, content: `auth ${MOCK_TRIGGERS.authError}`, mediaUrls: [] },
      ],
    });
    await posts.schedulePost(userId, post.id, { scheduledAt: new Date(), approve: true });
    const a = await publishPostPlatform(jobOf(post.id, xA), { attempt: 1, maxAttempts: 3 });
    const b = await publishPostPlatform(jobOf(post.id, xB), { attempt: 1, maxAttempts: 3 });
    expect(a).toMatchObject({ outcome: "failed", retryable: false, kind: "CONTENT" });
    expect(b).toMatchObject({ outcome: "failed", retryable: false, kind: "AUTH" });

    const detail = await posts.getPost(userId, post.id);
    expect(detail.status).toBe("FAILED");
    const failedB = detail.platforms.find((p) => p.socialAccountId === xB)!;
    expect(failedB.errorMessage).toContain("再接続");
    // 元のエラーは詳細ログにのみ残る
    const failLog = failedB.logs.find((l) => l.event === "POST_FAILED");
    expect(JSON.stringify(failLog!.metadata)).toContain("code 190");

    const [rowA, rowB] = await Promise.all([
      prisma.socialAccount.findUniqueOrThrow({ where: { id: xA } }),
      prisma.socialAccount.findUniqueOrThrow({ where: { id: xB } }),
    ]);
    expect(rowA.status).toBe("CONNECTED");
    expect(rowB.status).toBe("EXPIRED");

    // 再認証が必要なアカウントは予約できない → 接続確認で復帰
    const next = await posts.createPost(userId, { title: "t", topic: "", targets: [{ socialAccountId: xB, content: "a", mediaUrls: [] }] });
    const err = await posts.schedulePost(userId, next.id, { scheduledAt: future(), approve: true }).catch((e) => e);
    expect(err.details.join()).toContain("再接続が必要");
    expect((await accounts.recheckAccount(userId, xB)).status).toBe("CONNECTED");
  });

  it("切断したアカウントの投稿先は履歴に名前が残り、予約はできない", async () => {
    const extra = await accounts.connectAccount(userId, "THREADS", { credentials: { accessToken: "to-be-removed" } });
    const post = await posts.createPost(userId, {
      title: "t",
      topic: "",
      targets: [{ socialAccountId: extra.id, content: "a", mediaUrls: [] }],
    });
    await accounts.disconnectAccount(userId, extra.id);
    const after = await posts.getPost(userId, post.id);
    expect(after.platforms[0].socialAccountId).toBeNull();
    expect(after.platforms[0].accountName).toBe(extra.accountName);
    const err = await posts.schedulePost(userId, post.id, { scheduledAt: future(), approve: true }).catch((e) => e);
    expect(err.details.join()).toContain("切断されています");
  });

  it("文字数超過・Instagram の画像なしは予約できない。画像URLを付ければ投稿できる", async () => {
    const ig = await accounts.connectAccount(userId, "INSTAGRAM", { credentials: { accessToken: "ig-token" } });
    const post = await posts.createPost(userId, {
      title: "t",
      topic: "",
      targets: [
        { socialAccountId: ig.id, content: "キャプション", mediaUrls: [] },
        { socialAccountId: xA, content: "あ".repeat(281), mediaUrls: [] },
      ],
    });
    const err = await posts.schedulePost(userId, post.id, { scheduledAt: future(), approve: true }).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details.join()).toContain("画像のURLを入力してください");
    expect(err.details.join()).toContain("280文字以内");
    expect(scheduled.size).toBe(0);

    const ok = await posts.createPost(userId, {
      title: "t",
      topic: "",
      targets: [{ socialAccountId: ig.id, content: "キャプション", mediaUrls: ["https://example.com/a.jpg"] }],
    });
    await posts.schedulePost(userId, ok.id, { scheduledAt: new Date(), approve: true });
    expect(await publishPostPlatform(jobOf(ok.id, ig.id), { attempt: 1, maxAttempts: 3 })).toMatchObject({ outcome: "published" });
  });

  it("他のユーザーのアカウントは投稿先に指定できない", async () => {
    const other = await prisma.user.create({ data: { email: `it-${randomUUID()}@example.com`, passwordHash: "x" } });
    try {
      await expect(
        posts.createPost(other.id, { title: "t", topic: "", targets: [{ socialAccountId: xA, content: "a", mediaUrls: [] }] }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it("過去日時は予約できない", async () => {
    const post = await posts.createPost(userId, { title: "t", topic: "", targets: [{ socialAccountId: xA, content: "a", mediaUrls: [] }] });
    await expect(
      posts.schedulePost(userId, post.id, { scheduledAt: new Date(Date.now() - 10 * 60 * 1000), approve: true }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEDULE" });
  });

  it("予約後に編集すると予約が解除され、承認もやり直しになる。投稿先の追加・削除もできる", async () => {
    const post = await posts.createPost(userId, { title: "t", topic: "", targets: [{ socialAccountId: xA, content: "a", mediaUrls: [] }] });
    await posts.schedulePost(userId, post.id, { scheduledAt: future(), approve: true });
    const edited = await posts.updatePost(userId, post.id, {
      title: "t2",
      topic: "",
      targets: [
        { socialAccountId: xB, content: "b", mediaUrls: [] },
        { socialAccountId: threads, content: "c", mediaUrls: [] },
      ],
    });
    expect(cancelled).toContain(`${post.id}:${xA}`);
    expect(edited.status).toBe("READY");
    expect(edited.approvalStatus).toBe("PENDING");
    expect(edited.scheduledAt).toBeNull();
    expect(edited.platforms.map((p) => p.socialAccountId).sort()).toEqual([xB, threads].sort());
  });

  it("予約取消・却下・削除", async () => {
    const post = await posts.createPost(userId, { title: "t", topic: "", targets: [{ socialAccountId: xA, content: "a", mediaUrls: [] }] });
    await posts.schedulePost(userId, post.id, { scheduledAt: future(), approve: true });
    expect((await posts.cancelSchedule(userId, post.id)).status).toBe("READY");

    const rejected = await posts.rejectPost(userId, post.id);
    expect(rejected.approvalStatus).toBe("REJECTED");
    await expect(posts.schedulePost(userId, post.id, { scheduledAt: future() })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });

    await posts.deletePost(userId, post.id);
    await expect(posts.getPost(userId, post.id)).rejects.toMatchObject({ status: 404 });
  });

  it("承認モード「完全自動」では承認不要で予約できる", async () => {
    await prisma.user.update({ where: { id: userId }, data: { approvalMode: "AUTO" } });
    try {
      const post = await posts.createPost(userId, { title: "t", topic: "", targets: [{ socialAccountId: xA, content: "a", mediaUrls: [] }] });
      expect(post.approvalStatus).toBe("NOT_REQUIRED");
      expect((await posts.schedulePost(userId, post.id, { scheduledAt: future() })).status).toBe("SCHEDULED");
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { approvalMode: "ALWAYS" } });
    }
  });
});
