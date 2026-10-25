import type { Worker } from "bullmq";
import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/logging/logger";

// Worker を起動し、終了シグナルで安全に止める共通処理
export function runWorkers(start: () => Promise<Worker[]>): void {
  start()
    .then((workers) => {
      const shutdown = async () => {
        logger.info("worker.shutdown");
        await Promise.all(workers.map((w) => w.close()));
        await prisma.$disconnect();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      logger.error("worker.fatal", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
}

// 直接起動されたファイルかどうか（npm run worker:post などで単独起動する場合）
export function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl.endsWith(process.argv[1].replace(/\\/g, "/").split("/").slice(-2).join("/"));
}
