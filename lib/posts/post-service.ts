import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { formatDateTime, isValidScheduleTime } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { ServiceError, notFound } from "@/lib/errors/service-error";
import { logger } from "@/lib/logging/logger";
import { getPublishScheduler } from "@/lib/queue/post-queue";
import { listPostableAccounts } from "@/lib/social/account-service";
import { getAdapter } from "@/lib/social/registry";
import type { PostInput } from "@/lib/validation/schemas";
import { writePostLog } from "./post-log";
import { computePostStatus, initialApprovalStatus, isApproved, isEditable } from "./status";

const platformOrder = [{ platform: "asc" }, { accountName: "asc" }] satisfies Prisma.PostPlatformOrderByWithRelationInput[];

const postInclude = {
  platforms: { orderBy: platformOrder },
  brand: { select: { id: true, name: true } },
} satisfies Prisma.PostInclude;

export type PostWithPlatforms = Prisma.PostGetPayload<{ include: typeof postInclude }>;

// 二重投稿防止キー。同じ投稿・同じアカウントへの投稿は1回だけ
export function idempotencyKeyFor(postId: string, socialAccountId: string): string {
  return `${postId}:${socialAccountId}`;
}

// 入力された投稿先アカウントが本人のものか確認し、SNS種別と表示名を補う
async function resolveTargets(userId: string, targets: PostInput["targets"]) {
  const accounts = await prisma.socialAccount.findMany({
    where: { userId, id: { in: targets.map((t) => t.socialAccountId) } },
    select: { id: true, platform: true, accountName: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return targets.map((t) => {
    const account = byId.get(t.socialAccountId);
    if (!account) throw notFound("投稿先のSNSアカウント");
    return { ...t, platform: account.platform, accountName: account.accountName };
  });
}

function targetLabel(p: { platform: keyof typeof PLATFORM_LABELS; accountName: string }): string {
  return `${PLATFORM_LABELS[p.platform]} ${p.accountName}`.trim();
}

async function findOwnedPost(userId: string, postId: string): Promise<PostWithPlatforms> {
  const post = await prisma.post.findFirst({ where: { id: postId, userId }, include: postInclude });
  if (!post) throw notFound("投稿");
  return post;
}

async function assertBrandOwned(userId: string, brandId: string | null | undefined): Promise<void> {
  if (!brandId) return;
  const brand = await prisma.brand.findFirst({ where: { id: brandId, userId }, select: { id: true } });
  if (!brand) throw notFound("ブランド");
}

// SNS別の状態から Post.status を再計算して保存する
export async function refreshPostStatus(postId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const platforms = await db.postPlatform.findMany({ where: { postId }, select: { status: true, content: true } });
  const hasAllContent = platforms.length > 0 && platforms.every((p) => p.content.trim().length > 0);
  const status = computePostStatus(
    platforms.map((p) => p.status),
    hasAllContent,
  );
  await db.post.update({ where: { id: postId }, data: { status } });
  return status;
}

export async function listPosts(userId: string, filter: { status?: string } = {}) {
  return prisma.post.findMany({
    where: { userId, ...(filter.status ? { status: filter.status as PostWithPlatforms["status"] } : {}) },
    include: postInclude,
    orderBy: [{ updatedAt: "desc" }],
  });
}

export async function getPost(userId: string, postId: string) {
  const post = await prisma.post.findFirst({
    where: { id: postId, userId },
    include: {
      ...postInclude,
      platforms: {
        orderBy: { platform: "asc" },
        include: { logs: { orderBy: { createdAt: "desc" }, take: 50 } },
      },
    },
  });
  if (!post) throw notFound("投稿");
  return post;
}

export async function createPost(userId: string, input: PostInput): Promise<PostWithPlatforms> {
  await assertBrandOwned(userId, input.brandId);
  const targets = await resolveTargets(userId, input.targets);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { approvalMode: true } });

  const postId = await prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        userId,
        brandId: input.brandId ?? null,
        title: input.title,
        topic: input.topic,
        approvalStatus: initialApprovalStatus(user.approvalMode, "manual"),
      },
    });
    for (const t of targets) {
      await tx.postPlatform.create({
        data: {
          postId: post.id,
          platform: t.platform,
          socialAccountId: t.socialAccountId,
          accountName: t.accountName,
          content: t.content,
          mediaUrls: t.mediaUrls,
          idempotencyKey: idempotencyKeyFor(post.id, t.socialAccountId),
        },
      });
    }
    const ids = (await tx.postPlatform.findMany({ where: { postId: post.id }, select: { id: true } })).map((p) => p.id);
    await writePostLog({ postPlatformIds: ids, event: "POST_CREATED", status: "INFO", message: "投稿を作成しました" }, tx);
    await refreshPostStatus(post.id, tx);
    return post.id;
  });

  logger.info("post.created", { userId, postId });
  return findOwnedPost(userId, postId);
}

// 予約済みのジョブを取り消し、SNS別の状態を下書きに戻す（投稿済みのものは残す）
async function unschedule(post: PostWithPlatforms): Promise<string[]> {
  const targets = post.platforms.filter((p) => p.status === "SCHEDULED" || p.status === "FAILED");
  const scheduler = getPublishScheduler();
  for (const p of targets) await scheduler.cancel(p.idempotencyKey);
  if (targets.length > 0) {
    await prisma.postPlatform.updateMany({
      where: { id: { in: targets.map((p) => p.id) } },
      data: { status: "DRAFT", errorMessage: null },
    });
  }
  return targets.map((p) => p.id);
}

export async function updatePost(userId: string, postId: string, input: PostInput): Promise<PostWithPlatforms> {
  const post = await findOwnedPost(userId, postId);
  if (!isEditable(post.status)) {
    throw new ServiceError(409, "投稿中・投稿済みの投稿は編集できません", "NOT_EDITABLE");
  }
  if (post.platforms.some((p) => p.status === "PUBLISHED")) {
    throw new ServiceError(409, "一部のアカウントに投稿済みのため編集できません", "NOT_EDITABLE");
  }
  await assertBrandOwned(userId, input.brandId);
  const targets = await resolveTargets(userId, input.targets);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { approvalMode: true } });

  // 内容が変わったら予約を解除し、承認をやり直す（承認後にすり替わるのを防ぐ）
  const wasScheduled = await unschedule(post);

  await prisma.$transaction(async (tx) => {
    await tx.post.update({
      where: { id: postId },
      data: {
        title: input.title,
        topic: input.topic,
        brandId: input.brandId ?? null,
        scheduledAt: null,
        approvalStatus: initialApprovalStatus(user.approvalMode, "manual"),
      },
    });
    const wanted = new Set(targets.map((t) => t.socialAccountId));
    const removed = post.platforms.filter((p) => !p.socialAccountId || !wanted.has(p.socialAccountId));
    if (removed.length > 0) await tx.postPlatform.deleteMany({ where: { id: { in: removed.map((p) => p.id) } } });

    for (const t of targets) {
      const fields = { content: t.content, mediaUrls: t.mediaUrls, accountName: t.accountName };
      const existing = post.platforms.find((p) => p.socialAccountId === t.socialAccountId);
      if (existing) {
        await tx.postPlatform.update({ where: { id: existing.id }, data: { ...fields, status: "DRAFT", errorMessage: null } });
      } else {
        await tx.postPlatform.create({
          data: {
            postId,
            platform: t.platform,
            socialAccountId: t.socialAccountId,
            idempotencyKey: idempotencyKeyFor(postId, t.socialAccountId),
            ...fields,
          },
        });
      }
    }
    const ids = (await tx.postPlatform.findMany({ where: { postId }, select: { id: true } })).map((p) => p.id);
    await writePostLog(
      {
        postPlatformIds: ids,
        event: "POST_UPDATED",
        status: "INFO",
        message: wasScheduled.length > 0 ? "投稿を編集しました（予約は解除されました）" : "投稿を編集しました",
      },
      tx,
    );
    await refreshPostStatus(postId, tx);
  });

  return findOwnedPost(userId, postId);
}

export async function deletePost(userId: string, postId: string): Promise<void> {
  const post = await findOwnedPost(userId, postId);
  if (post.status === "POSTING") throw new ServiceError(409, "投稿処理中のため削除できません", "NOT_EDITABLE");
  await unschedule(post);
  await prisma.post.delete({ where: { id: postId } });
  logger.info("post.deleted", { userId, postId });
}

export async function approvePost(userId: string, postId: string, message = "投稿を承認しました") {
  const post = await findOwnedPost(userId, postId);
  if (!isEditable(post.status)) throw new ServiceError(409, "この投稿は承認できない状態です", "INVALID_STATE");
  await prisma.post.update({ where: { id: postId }, data: { approvalStatus: "APPROVED" } });
  await writePostLog({
    postPlatformIds: post.platforms.map((p) => p.id),
    event: "APPROVED",
    status: "SUCCESS",
    message,
  });
  return findOwnedPost(userId, postId);
}

export async function rejectPost(userId: string, postId: string) {
  const post = await findOwnedPost(userId, postId);
  if (!isEditable(post.status)) throw new ServiceError(409, "この投稿は却下できない状態です", "INVALID_STATE");
  await unschedule(post);
  await prisma.post.update({ where: { id: postId }, data: { approvalStatus: "REJECTED", scheduledAt: null } });
  await writePostLog({
    postPlatformIds: post.platforms.map((p) => p.id),
    event: "REJECTED",
    status: "WARNING",
    message: "投稿を却下しました",
  });
  await refreshPostStatus(postId);
  return findOwnedPost(userId, postId);
}

export async function cancelSchedule(userId: string, postId: string) {
  const post = await findOwnedPost(userId, postId);
  const ids = await unschedule(post);
  if (ids.length === 0) throw new ServiceError(409, "予約中の投稿がありません", "INVALID_STATE");
  await prisma.post.update({ where: { id: postId }, data: { scheduledAt: null } });
  await writePostLog({ postPlatformIds: ids, event: "CANCELLED", status: "INFO", message: "予約を取り消しました" });
  await refreshPostStatus(postId);
  return findOwnedPost(userId, postId);
}

// 投稿前チェック：SNSの仕様・投稿先アカウントの接続状況
async function validateForPublishing(userId: string, post: PostWithPlatforms): Promise<string[]> {
  const errors: string[] = [];
  const postable = new Set((await listPostableAccounts(userId)).map((a) => a.id));
  for (const p of post.platforms) {
    if (p.status === "PUBLISHED") continue;
    if (!p.socialAccountId) {
      errors.push(`${targetLabel(p)} は切断されています。投稿先を選び直してください。`);
    } else if (!postable.has(p.socialAccountId)) {
      errors.push(`${targetLabel(p)} は再接続が必要です。アカウント画面でキーを確認してください。`);
    }
    const result = await getAdapter(p.platform).validatePost({
      platform: p.platform,
      content: p.content,
      mediaUrls: p.mediaUrls,
      idempotencyKey: p.idempotencyKey,
    });
    errors.push(...result.errors.map((e) => e.replace(`${PLATFORM_LABELS[p.platform]}:`, `${targetLabel(p)}:`)));
  }
  return errors;
}

// 予約（runAt が現在時刻なら「今すぐ投稿」）。実際の投稿は Worker が行う
export async function schedulePost(
  userId: string,
  postId: string,
  input: { scheduledAt: Date; approve?: boolean },
): Promise<PostWithPlatforms> {
  if (!isValidScheduleTime(input.scheduledAt)) {
    throw new ServiceError(400, "投稿日時には現在より後の日時を指定してください", "INVALID_SCHEDULE");
  }
  let post = await findOwnedPost(userId, postId);
  if (!isEditable(post.status)) throw new ServiceError(409, "この投稿は予約できない状態です", "INVALID_STATE");

  const errors = await validateForPublishing(userId, post);
  if (errors.length > 0) throw new ServiceError(400, "投稿内容を確認してください", "VALIDATION_ERROR", errors);

  if (input.approve && !isApproved(post.approvalStatus)) {
    post = await approvePost(userId, postId, "作成者が予約時に承認しました");
  }
  if (!isApproved(post.approvalStatus)) {
    throw new ServiceError(409, "承認されていない投稿は予約できません。先に承認してください。", "APPROVAL_REQUIRED");
  }

  const targets = post.platforms.filter((p) => p.status !== "PUBLISHED");
  await prisma.$transaction(async (tx) => {
    await tx.postPlatform.updateMany({
      where: { id: { in: targets.map((p) => p.id) } },
      data: { status: "SCHEDULED", errorMessage: null, attempts: 0 },
    });
    await tx.post.update({ where: { id: postId }, data: { scheduledAt: input.scheduledAt } });
    await refreshPostStatus(postId, tx);
  });

  const scheduler = getPublishScheduler();
  try {
    for (const p of targets) {
      await scheduler.schedule({ postPlatformId: p.id, idempotencyKey: p.idempotencyKey, runAt: input.scheduledAt });
    }
  } catch (err) {
    // キューに登録できなければ状態を戻す（DBだけ「予約済み」になるのを防ぐ）
    logger.error("post.schedule.queue_failed", { postId, error: err instanceof Error ? err.message : String(err) });
    await unschedule(await findOwnedPost(userId, postId));
    await refreshPostStatus(postId);
    throw new ServiceError(503, "予約処理を開始できませんでした。時間をおいて再度お試しください。", "QUEUE_UNAVAILABLE");
  }

  await writePostLog({
    postPlatformIds: targets.map((p) => p.id),
    event: "SCHEDULED",
    status: "INFO",
    message: `投稿を予約しました（${formatDateTime(input.scheduledAt)}）`,
    metadata: { scheduledAt: input.scheduledAt.toISOString() },
  });
  logger.info("post.scheduled", { userId, postId, scheduledAt: input.scheduledAt.toISOString() });
  return findOwnedPost(userId, postId);
}
