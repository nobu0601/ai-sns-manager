import { Queue } from "bullmq";
import { delayUntil } from "@/lib/datetime";
import { createRedisConnection } from "./connection";
import { MAX_PUBLISH_ATTEMPTS } from "./retry";

export const POST_PUBLISH_QUEUE = "post-publish";

export interface PublishJobData {
  postPlatformId: string;
}

// 予約投稿をキューに登録・取消するための抽象。テストでは差し替える。
export interface PublishScheduler {
  schedule(input: { postPlatformId: string; idempotencyKey: string; runAt: Date }): Promise<void>;
  cancel(idempotencyKey: string): Promise<void>;
}

// BullMQ の jobId に ":" は使えないため置き換える。同じ jobId のジョブは二重登録されない。
export function jobIdFor(idempotencyKey: string): string {
  return `publish_${idempotencyKey.replace(/:/g, "_")}`;
}

let queue: Queue<PublishJobData> | null = null;

function getQueue(): Queue<PublishJobData> {
  if (!queue) {
    queue = new Queue<PublishJobData>(POST_PUBLISH_QUEUE, { connection: createRedisConnection() });
  }
  return queue;
}

async function removeIfPossible(jobId: string): Promise<void> {
  const job = await getQueue().getJob(jobId);
  if (!job) return;
  // 実行中のジョブは消せない（状態遷移は publish-service 側で保護している）
  if (await job.isActive()) return;
  await job.remove();
}

export const bullmqScheduler: PublishScheduler = {
  async schedule({ postPlatformId, idempotencyKey, runAt }) {
    const jobId = jobIdFor(idempotencyKey);
    // 再予約時は古いジョブ（待機中・完了・失敗）を消してから登録し直す
    await removeIfPossible(jobId);
    await getQueue().add(
      "publish",
      { postPlatformId },
      {
        jobId,
        delay: delayUntil(runAt),
        attempts: MAX_PUBLISH_ATTEMPTS,
        backoff: { type: "custom" },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    );
  },
  async cancel(idempotencyKey) {
    await removeIfPossible(jobIdFor(idempotencyKey));
  },
};

let scheduler: PublishScheduler = bullmqScheduler;

export function getPublishScheduler(): PublishScheduler {
  return scheduler;
}

export function setPublishScheduler(next: PublishScheduler): void {
  scheduler = next;
}
