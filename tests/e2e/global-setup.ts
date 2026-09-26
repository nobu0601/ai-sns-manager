import { spawn } from "node:child_process";

// 投稿を実行する Worker を E2E 実行中だけ起動する（E2E_SKIP_WORKER=1 なら起動済みのものを使う）
export default async function globalSetup() {
  if (process.env.E2E_SKIP_WORKER) return;
  const worker = spawn("npx", ["tsx", "workers/post-worker.ts"], { stdio: "inherit", detached: true });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return async () => {
    if (worker.pid) process.kill(-worker.pid, "SIGTERM");
  };
}
