import IORedis from "ioredis";

export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL が設定されていません");
  // BullMQ の Worker はブロッキングコマンドを使うため maxRetriesPerRequest: null が必須
  return new IORedis(url, { maxRetriesPerRequest: null });
}
