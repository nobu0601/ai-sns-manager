import type { Platform } from "@prisma/client";
import type { SocialErrorKind } from "@/lib/social/errors";

export const PLATFORM_LABELS: Record<Platform, string> = {
  X: "X",
  INSTAGRAM: "Instagram",
  THREADS: "Threads",
};

// 技術的なエラーをそのまま見せず、ユーザーが次に何をすればよいか分かる文にする。
// willRetry: この後 Worker が自動で再試行するか（最終的に失敗したときは false）
export function userMessageFor(kind: SocialErrorKind, platform: Platform, { willRetry = false } = {}): string {
  const name = PLATFORM_LABELS[platform];
  const retryHint = willRetry ? "自動で再試行します。" : "時間をおいて「今すぐ再投稿」を押してください。";
  switch (kind) {
    case "AUTH":
      return `${name}との接続が切れています。アカウント画面から再接続してください。`;
    case "PERMISSION":
      return `${name}への投稿権限がありません。アカウント画面から再接続し、投稿の許可を与えてください。`;
    case "CONTENT":
      return `${name}の投稿ルールに合わない内容です。文字数や内容を見直してください。`;
    case "RATE_LIMIT":
      return `${name}の投稿回数の上限に達しました。${retryHint}`;
    case "TRANSIENT":
      return willRetry
        ? `${name}に一時的につながりませんでした。${retryHint}`
        : `${name}につながらず、投稿できませんでした。${retryHint}`;
    case "NOT_IMPLEMENTED":
      return `${name}への実際の投稿はまだ対応していません（現在はMockモードのみ対応）。`;
    default:
      return `${name}への投稿に失敗しました。${retryHint}`;
  }
}
