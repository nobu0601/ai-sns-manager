// 予約投稿を実行する Worker。Webサーバーとは別プロセスで起動する（npm run worker）。
import { UnrecoverableError, Worker } from "bullmq";
import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/logging/logger";
import { publishPostPlatform } from "@/lib/posts/publish-service";
import { createRedisConnection } from "@/lib/queue/connection";
import { POST_PUBLISH_QUEUE, bullmqScheduler, type PublishJobData } from "@/lib/queue/post-queue";
import { MAX_PUBLISH_ATTEMPTS, retryDelayMs } from "@/lib/queue/retry";

// Redis のデータ消失などで「DBでは予約中なのにジョブが無い」状態を起動時に補正する
async function reconcileScheduledPosts(): Promise<void> {
  const pending = await prisma.postPlatform.findMany({
    where: { status: { in: ["SCHEDULED", "POSTING"] } },
    include: { post: { select: { scheduledAt: true } } },
  });
  for (const p of pending) {
    await bullmqScheduler.schedule({
      postPlatformId: p.id,
      idempotencyKey: p.idempotencyKey,
      runAt: p.post.scheduledAt ?? new Date(),
    });
  }
  if (pending.length > 0) logger.info("worker.reconciled", { count: pending.length });
}

async function main() {
  await reconcileScheduledPosts();

  const worker = new Worker<PublishJobData>(
    POST_PUBLISH_QUEUE,
    async (job) => {
      const maxAttempts = job.opts.attempts ?? MAX_PUBLISH_ATTEMPTS;
      const result = await publishPostPlatform(job.data.postPlatformId, {
        attempt: job.attemptsMade + 1,
        maxAttempts,
      });
      if (result.outcome === "failed") {
        // 再試行しても成功しないエラー（認証・権限・内容）は即座に打ち切る
        if (!result.retryable) throw new UnrecoverableError(`publish failed: ${result.kind}`);
        throw new Error(`publish failed (retryable): ${result.kind}`);
      }
      return result;
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
      settings: { backoffStrategy: (attemptsMade: number) => retryDelayMs(attemptsMade) },
    },
  );

  worker.on("ready", () => logger.info("worker.ready", { queue: POST_PUBLISH_QUEUE }));
  worker.on("error", (err) => logger.error("worker.error", { error: err.message }));

  const shutdown = async () => {
    logger.info("worker.shutdown");
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("worker.fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
