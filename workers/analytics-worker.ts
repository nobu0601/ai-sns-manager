// 分析の Worker。6時間ごとの数値の自動取得、画面の「数値を更新」、AI 分析を処理する
import { Worker } from "bullmq";
import { executeAnalysis } from "@/lib/analytics/analysis-service";
import { collectMetrics } from "@/lib/analytics/metrics-service";
import { logger } from "@/lib/logging/logger";
import { createRedisConnection } from "@/lib/queue/connection";
import { ANALYTICS_QUEUE, upsertMetricsSchedule, type AnalyticsJobData } from "@/lib/queue/jobs";
import { isMain, runWorkers } from "./run";

export async function startAnalyticsWorker(): Promise<Worker[]> {
  await upsertMetricsSchedule();

  const worker = new Worker<AnalyticsJobData>(
    ANALYTICS_QUEUE,
    async (job) => {
      switch (job.data.type) {
        case "refresh-all":
          return collectMetrics();
        case "refresh":
          return collectMetrics({ userId: job.data.userId });
        case "analyze":
          return executeAnalysis(job.data.reportId);
      }
    },
    // SNS への問い合わせと Claude の呼び出しに時間がかかるため、ロックを長めにする
    { connection: createRedisConnection(), concurrency: 1, lockDuration: 15 * 60 * 1000 },
  );
  worker.on("ready", () => logger.info("worker.ready", { queue: ANALYTICS_QUEUE }));
  worker.on("error", (err) => logger.error("worker.error", { queue: ANALYTICS_QUEUE, error: err.message }));
  return [worker];
}

if (isMain(import.meta.url)) runWorkers(startAnalyticsWorker);
