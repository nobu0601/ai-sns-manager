// すべての Worker（投稿・画像/動画生成・AI Agent・分析）を1つのプロセスで起動する（npm run worker）
import { startAiWorker } from "./ai-worker";
import { startAnalyticsWorker } from "./analytics-worker";
import { startMediaWorker } from "./media-worker";
import { startPostWorker } from "./post-worker";
import { runWorkers } from "./run";

runWorkers(async () => [
  ...(await startPostWorker()),
  ...(await startMediaWorker()),
  ...(await startAiWorker()),
  ...(await startAnalyticsWorker()),
]);
