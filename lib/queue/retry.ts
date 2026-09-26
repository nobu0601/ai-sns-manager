// 投稿失敗時のリトライ設定。1回目失敗→30秒後、2回目失敗→2分後、3回目で打ち切り。
export const MAX_PUBLISH_ATTEMPTS = 3;
export const RETRY_DELAYS_MS = [30_000, 120_000];

// attemptsMade: これまでに失敗した回数（1始まり）
export function retryDelayMs(attemptsMade: number): number {
  const index = Math.min(Math.max(attemptsMade, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index];
}
