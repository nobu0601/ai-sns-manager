import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";

const hasRedis = Boolean(process.env.REDIS_URL);

// Redis を使うキューの統合テスト：予約・再予約・取消・重複防止
describe.skipIf(!hasRedis)("投稿キュー（統合）", async () => {
  const { bullmqScheduler, jobIdFor, POST_PUBLISH_QUEUE } = await import("@/lib/queue/post-queue");
  const { createRedisConnection } = await import("@/lib/queue/connection");
  const connection = createRedisConnection();
  const queue = new Queue(POST_PUBLISH_QUEUE, { connection });
  const key = `test-${randomUUID()}:X`;

  afterAll(async () => {
    await bullmqScheduler.cancel(key);
    await queue.close();
    await connection.quit();
  });

  it("予約するとリトライ設定付きの遅延ジョブが1件だけ登録される", async () => {
    const runAt = new Date(Date.now() + 10 * 60 * 1000);
    await bullmqScheduler.schedule({ postPlatformId: "pp1", idempotencyKey: key, runAt });
    await bullmqScheduler.schedule({ postPlatformId: "pp1", idempotencyKey: key, runAt });

    const job = await queue.getJob(jobIdFor(key));
    expect(job).toBeDefined();
    expect(await job!.getState()).toBe("delayed");
    expect(job!.opts.attempts).toBe(3);
    expect(job!.opts.backoff).toMatchObject({ type: "custom" });
    expect(job!.opts.delay).toBeGreaterThan(9 * 60 * 1000);
    const delayed = (await queue.getDelayed()).filter((j) => j.id === jobIdFor(key));
    expect(delayed).toHaveLength(1);
  });

  it("取消するとジョブが消える", async () => {
    await bullmqScheduler.cancel(key);
    expect(await queue.getJob(jobIdFor(key))).toBeUndefined();
  });
});
