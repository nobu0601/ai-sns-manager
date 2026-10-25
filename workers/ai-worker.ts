// AI Agent を実行する Worker。ボタンからの実行と、毎週の自動実行（BullMQ のジョブスケジューラ）を処理する
import { Worker } from "bullmq";
import { executeAgentRun, reconcileWeeklySchedules, startWeeklyRun } from "@/lib/agent/agent-service";
import { logger } from "@/lib/logging/logger";
import { createRedisConnection } from "@/lib/queue/connection";
import { AGENT_QUEUE, type AgentJobData } from "@/lib/queue/jobs";
import { isMain, runWorkers } from "./run";

export async function startAiWorker(): Promise<Worker[]> {
  const count = await reconcileWeeklySchedules();
  if (count > 0) logger.info("agent.weekly_schedules", { count });

  const worker = new Worker<AgentJobData>(
    AGENT_QUEUE,
    async (job) => {
      const runId = "runId" in job.data ? job.data.runId : await startWeeklyRun(job.data.weeklyConfigId);
      if (runId) await executeAgentRun(runId);
    },
    // 1回の実行で Claude を何度も呼ぶため、ロックを長めにする
    { connection: createRedisConnection(), concurrency: 1, lockDuration: 15 * 60 * 1000 },
  );
  worker.on("ready", () => logger.info("worker.ready", { queue: AGENT_QUEUE }));
  worker.on("error", (err) => logger.error("worker.error", { queue: AGENT_QUEUE, error: err.message }));
  return [worker];
}

if (isMain(import.meta.url)) runWorkers(startAiWorker);
