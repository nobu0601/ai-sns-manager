import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";

// 画像・動画生成と AI Agent のジョブ。投稿キュー（post-queue.ts）と同じく、テストでは差し替える
export const MEDIA_QUEUE = "media-generate";
export const AGENT_QUEUE = "agent-run";

export interface MediaJobData {
  mediaId: string;
  brandId?: string | null;
}

export type AgentJobData = { runId: string } | { weeklyConfigId: string };

export interface JobDispatcher {
  enqueueMedia(data: MediaJobData): Promise<void>;
  enqueueAgentRun(runId: string): Promise<void>;
  // 毎週の自動実行（日本時間の曜日・時刻）を登録・解除する
  upsertWeeklyAgent(configId: string, weekday: number, time: string): Promise<void>;
  removeWeeklyAgent(configId: string): Promise<void>;
}

export const APP_TZ = "Asia/Tokyo";

// "HH:mm" と曜日（0=日）から cron 式を作る
export function weeklyCron(weekday: number, time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${m} ${h} * * ${weekday}`;
}

export const weeklySchedulerId = (configId: string) => `agent-weekly-${configId}`;

const queues = new Map<string, Queue>();
function queue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: createRedisConnection() });
    queues.set(name, q);
  }
  return q;
}

export const bullmqDispatcher: JobDispatcher = {
  async enqueueMedia(data) {
    await queue(MEDIA_QUEUE).add("generate", data, {
      jobId: `media_${data.mediaId}`,
      attempts: 2,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    });
  },
  async enqueueAgentRun(runId) {
    await queue(AGENT_QUEUE).add("run", { runId } satisfies AgentJobData, {
      jobId: `agent_${runId}`,
      attempts: 1,
      removeOnComplete: { age: 30 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    });
  },
  async upsertWeeklyAgent(configId, weekday, time) {
    await queue(AGENT_QUEUE).upsertJobScheduler(
      weeklySchedulerId(configId),
      { pattern: weeklyCron(weekday, time), tz: APP_TZ },
      { name: "weekly", data: { weeklyConfigId: configId } satisfies AgentJobData },
    );
  },
  async removeWeeklyAgent(configId) {
    await queue(AGENT_QUEUE).removeJobScheduler(weeklySchedulerId(configId));
  },
};

let dispatcher: JobDispatcher = bullmqDispatcher;

export function getJobDispatcher(): JobDispatcher {
  return dispatcher;
}

export function setJobDispatcher(next: JobDispatcher): void {
  dispatcher = next;
}
