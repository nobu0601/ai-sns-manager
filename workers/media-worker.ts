// 画像・動画を生成する Worker。生成には数十秒〜数分かかるため、Web リクエストとは別に処理する
import { UnrecoverableError, Worker } from "bullmq";
import { logger } from "@/lib/logging/logger";
import { processMedia } from "@/lib/media/media-service";
import { createRedisConnection } from "@/lib/queue/connection";
import { MEDIA_QUEUE, type MediaJobData } from "@/lib/queue/jobs";
import { isMain, runWorkers } from "./run";

export async function startMediaWorker(): Promise<Worker[]> {
  const worker = new Worker<MediaJobData>(
    MEDIA_QUEUE,
    async (job) => {
      const result = await processMedia(job.data.mediaId, {
        brandId: job.data.brandId,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
      });
      if (result.outcome === "failed") {
        if (!result.retryable) throw new UnrecoverableError("media generation failed");
        throw new Error("media generation failed (retryable)");
      }
      return result;
    },
    // 動画生成は長くかかるため、ロックを長めにする
    { connection: createRedisConnection(), concurrency: 2, lockDuration: 10 * 60 * 1000 },
  );
  worker.on("ready", () => logger.info("worker.ready", { queue: MEDIA_QUEUE }));
  worker.on("error", (err) => logger.error("worker.error", { queue: MEDIA_QUEUE, error: err.message }));
  return [worker];
}

if (isMain(import.meta.url)) runWorkers(startMediaWorker);
