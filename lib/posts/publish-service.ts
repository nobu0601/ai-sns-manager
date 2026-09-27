import { prisma } from "@/lib/database/prisma";
import { userMessageFor } from "@/lib/errors/user-messages";
import { logger } from "@/lib/logging/logger";
import { getPublishingAccount, markAccountExpired } from "@/lib/social/account-service";
import { SocialPublishError, toSocialError } from "@/lib/social/errors";
import { getAdapter } from "@/lib/social/registry";
import { writePostLog } from "./post-log";
import { refreshPostStatus } from "./post-service";
import { isApproved } from "./status";

export type PublishOutcome =
  | { outcome: "published"; externalPostId: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; retryable: boolean; kind: string };

// 1つのSNSへの投稿を実行する。Worker から呼ばれる。
// attempt: 今回が何回目か（1始まり） / maxAttempts: 最大試行回数
export async function publishPostPlatform(
  postPlatformId: string,
  { attempt, maxAttempts }: { attempt: number; maxAttempts: number },
): Promise<PublishOutcome> {
  const target = await prisma.postPlatform.findUnique({
    where: { id: postPlatformId },
    include: { post: { select: { id: true, userId: true, brandId: true, approvalStatus: true } } },
  });
  if (!target) return { outcome: "skipped", reason: "not_found" };

  // 二重投稿防止：投稿済み・取消済みなら何もしない
  if (target.status === "PUBLISHED" || target.status === "CANCELLED" || target.status === "DRAFT") {
    return { outcome: "skipped", reason: `status_${target.status}` };
  }
  if (!isApproved(target.post.approvalStatus)) {
    await writePostLog({
      postPlatformIds: [target.id],
      event: "POST_FAILED",
      status: "WARNING",
      message: "承認されていないため投稿をスキップしました",
    });
    return { outcome: "skipped", reason: "not_approved" };
  }

  // 投稿中へ遷移（予約済み・失敗・前回の投稿中断からのみ）。取得できなければ他で処理済み
  const claimed = await prisma.postPlatform.updateMany({
    where: { id: target.id, status: { in: ["SCHEDULED", "FAILED", "POSTING"] } },
    data: { status: "POSTING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { outcome: "skipped", reason: "already_claimed" };
  await refreshPostStatus(target.postId);
  await writePostLog({
    postPlatformIds: [target.id],
    event: "POST_STARTED",
    status: "INFO",
    message: `投稿を開始しました（${attempt}/${maxAttempts}回目）`,
  });

  const platform = target.platform;
  let accountId: string | null = null;
  try {
    const publishing = await getPublishingAccount(target.post.userId, platform, target.socialAccountId);
    accountId = publishing.id;
    const adapter = getAdapter(platform);
    const platformPost = {
      platform,
      content: target.content,
      mediaUrls: target.mediaUrls,
      idempotencyKey: target.idempotencyKey,
    };

    const validation = await adapter.validatePost(platformPost);
    if (!validation.valid) {
      throw new SocialPublishError("CONTENT", platform, validation.errors.join(" / "));
    }

    const published = await adapter.createPost(platformPost, publishing.credentials, publishing.account);
    await prisma.postPlatform.update({
      where: { id: target.id },
      data: {
        status: "PUBLISHED",
        publishedAt: published.publishedAt,
        externalPostId: published.externalPostId,
        externalUrl: published.externalUrl ?? null,
        errorMessage: null,
      },
    });
    await writePostLog({
      postPlatformIds: [target.id],
      event: "POST_SUCCESS",
      status: "SUCCESS",
      message: "投稿に成功しました",
      metadata: { externalPostId: published.externalPostId, externalUrl: published.externalUrl, response: published.raw },
    });
    await refreshPostStatus(target.postId);
    logger.info("publish.success", { postPlatformId: target.id, platform, accountId });
    return { outcome: "published", externalPostId: published.externalPostId };
  } catch (err) {
    const error = toSocialError(err, platform);
    const final = !error.retryable || attempt >= maxAttempts;
    const userMessage = userMessageFor(error.kind, platform, { willRetry: !final });
    // 元エラーは詳細ログにのみ残す（ユーザーには分かりやすい文を見せる）
    // SNS APIのエラーレスポンスも残す（秘密情報は writePostLog でマスクされる）
    const detail = { kind: error.kind, error: error.message, response: error.detail, attempt, maxAttempts };

    if (error.kind === "AUTH" && accountId) await markAccountExpired(accountId, userMessage);

    await prisma.postPlatform.update({
      where: { id: target.id },
      data: final ? { status: "FAILED", errorMessage: userMessage } : { status: "SCHEDULED", errorMessage: userMessage },
    });
    await writePostLog({
      postPlatformIds: [target.id],
      event: final ? "POST_FAILED" : "RETRY",
      status: final ? "ERROR" : "WARNING",
      message: final ? `投稿に失敗しました：${userMessage}` : `投稿に失敗したため再試行します：${userMessage}`,
      metadata: detail,
    });
    await refreshPostStatus(target.postId);
    logger.warn("publish.failed", { postPlatformId: target.id, platform, final, ...detail });
    return { outcome: "failed", retryable: !final, kind: error.kind };
  }
}
