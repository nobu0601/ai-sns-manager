import type { Media, MediaType } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { AIError } from "@/lib/ai/errors";
import { getAIProvider } from "@/lib/ai/registry";
import { ServiceError, notFound } from "@/lib/errors/service-error";
import { logger } from "@/lib/logging/logger";
import { writePostLog } from "@/lib/posts/post-log";
import { getJobDispatcher } from "@/lib/queue/jobs";
import { PLATFORM_CAPABILITIES } from "@/lib/social/capabilities";
import { MediaGenerationError } from "./errors";
import { getMediaProvider } from "./registry";
import type { AspectRatio } from "./types";

// 動画の長さ（秒）。fal.ai の動画モデルは 5 秒か 10 秒
export const VIDEO_DURATION_SECONDS = 10;

export async function requestMedia(
  userId: string,
  input: { type: MediaType; idea: string; aspectRatio: AspectRatio; brandId?: string | null; postId?: string | null },
): Promise<Media> {
  if (input.brandId) {
    const brand = await prisma.brand.findFirst({ where: { id: input.brandId, userId }, select: { id: true } });
    if (!brand) throw notFound("ブランド");
  }
  if (input.postId) {
    const post = await prisma.post.findFirst({ where: { id: input.postId, userId }, select: { id: true } });
    if (!post) throw notFound("投稿");
  }
  const media = await prisma.media.create({
    data: {
      userId,
      postId: input.postId ?? null,
      type: input.type,
      provider: getMediaProvider().name,
      idea: input.idea,
      aspectRatio: input.aspectRatio,
    },
  });
  try {
    await getJobDispatcher().enqueueMedia({ mediaId: media.id, brandId: input.brandId ?? null });
  } catch (err) {
    logger.error("media.enqueue_failed", { mediaId: media.id, error: err instanceof Error ? err.message : String(err) });
    await prisma.media.update({ where: { id: media.id }, data: { status: "FAILED", errorMessage: "生成を開始できませんでした。時間をおいてもう一度お試しください。" } });
    throw new ServiceError(503, "生成を開始できませんでした。時間をおいてもう一度お試しください。", "QUEUE_UNAVAILABLE");
  }
  logger.info("media.requested", { userId, mediaId: media.id, type: input.type });
  return media;
}

export async function getMedia(userId: string, mediaId: string): Promise<Media> {
  const media = await prisma.media.findFirst({ where: { id: mediaId, userId } });
  if (!media) throw notFound("画像・動画");
  return media;
}

export async function listRecentMedia(userId: string, limit = 12): Promise<Media[]> {
  return prisma.media.findMany({ where: { userId, status: "READY" }, orderBy: { createdAt: "desc" }, take: limit });
}

const RETRYABLE = new Set(["RATE_LIMIT", "UNAVAILABLE"]);

// Worker から呼ばれる。AI で生成用プロンプトを作り、画像・動画を生成する
export async function processMedia(
  mediaId: string,
  { brandId, attempt, maxAttempts }: { brandId?: string | null; attempt: number; maxAttempts: number },
): Promise<{ outcome: "ready" | "skipped" | "failed"; retryable?: boolean }> {
  const media = await prisma.media.findUnique({ where: { id: mediaId }, include: { post: { select: { brandId: true } } } });
  if (!media || media.status === "READY" || media.status === "FAILED") return { outcome: "skipped" };
  await prisma.media.update({ where: { id: media.id }, data: { status: "GENERATING" } });

  try {
    const brandKey = brandId ?? media.post?.brandId ?? null;
    const brand = brandKey ? await prisma.brand.findFirst({ where: { id: brandKey, userId: media.userId } }) : null;
    const prompt = media.prompt
      ? { prompt: media.prompt, script: media.script }
      : await getAIProvider().mediaPrompt({ type: media.type, idea: media.idea, aspectRatio: media.aspectRatio, brand });
    await prisma.media.update({ where: { id: media.id }, data: { prompt: prompt.prompt, script: prompt.script } });

    const provider = getMediaProvider();
    const aspectRatio = media.aspectRatio as AspectRatio;
    const generated =
      media.type === "VIDEO"
        ? await provider.generateVideo(prompt.prompt, { aspectRatio, durationSeconds: VIDEO_DURATION_SECONDS })
        : await provider.generateImage(prompt.prompt, { aspectRatio });
    const ready = await prisma.media.update({
      where: { id: media.id },
      data: { status: "READY", url: generated.url, model: generated.model, provider: provider.name, errorMessage: null },
    });
    logger.info("media.ready", { mediaId: media.id, type: media.type, model: generated.model });
    if (ready.postId) await onMediaReadyForPost(ready);
    return { outcome: "ready" };
  } catch (err) {
    const known = err instanceof MediaGenerationError || err instanceof AIError;
    const kind = known ? (err as MediaGenerationError | AIError).kind : "UNAVAILABLE";
    const retryable = RETRYABLE.has(kind) && attempt < maxAttempts;
    const message = known ? (err as Error).message : "画像・動画の生成に失敗しました。時間をおいてもう一度お試しください。";
    logger.warn("media.failed", {
      mediaId: media.id,
      kind,
      retryable,
      detail: known ? (err as MediaGenerationError).detail : err instanceof Error ? err.message : String(err),
    });
    await prisma.media.update({
      where: { id: media.id },
      data: retryable ? { status: "PENDING" } : { status: "FAILED", errorMessage: message },
    });
    return { outcome: "failed", retryable };
  }
}

// 投稿に紐付いた画像・動画ができたら、その種類に対応する投稿先に添付する。
// Agent が作った投稿で、投稿モードが「完全自動」なら、そのまま予約する
async function onMediaReadyForPost(media: Media): Promise<void> {
  if (!media.postId || !media.url) return;
  const post = await prisma.post.findUnique({
    where: { id: media.postId },
    include: { platforms: true, user: { select: { approvalMode: true } } },
  });
  if (!post || post.status === "POSTING" || post.status === "PUBLISHED") return;

  const targets = post.platforms.filter((p) => {
    const caps = PLATFORM_CAPABILITIES[p.platform];
    return p.status === "DRAFT" && (media.type === "VIDEO" ? caps.videoPost : caps.imagePost);
  });
  if (targets.length === 0) return;
  await prisma.postPlatform.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { mediaUrls: [media.url], mediaType: media.type },
  });
  await writePostLog({
    postPlatformIds: targets.map((t) => t.id),
    event: "POST_UPDATED",
    status: "INFO",
    message: `生成した${media.type === "VIDEO" ? "動画" : "画像"}を添付しました`,
    metadata: { mediaId: media.id },
  });

  if (post.agentRunId && post.user.approvalMode === "AUTO" && post.scheduledAt && post.scheduledAt > new Date()) {
    // 循環参照を避けるため遅延 import
    const { schedulePost } = await import("@/lib/posts/post-service");
    try {
      await schedulePost(post.userId, post.id, { scheduledAt: post.scheduledAt });
    } catch (err) {
      logger.warn("agent.auto_schedule_failed", { postId: post.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
