import type { Platform } from "@prisma/client";
import type { SocialErrorKind } from "@/lib/social/errors";

export const PLATFORM_LABELS: Record<Platform, string> = {
  X: "X",
  INSTAGRAM: "Instagram",
  THREADS: "Threads",
};

// 技術的なエラーをそのまま見せず、ユーザーが次に何をすればよいか分かる文にする
export function userMessageFor(kind: SocialErrorKind, platform: Platform): string {
  const name = PLATFORM_LABELS[platform];
  switch (kind) {
    case "AUTH":
      return `${name}との接続が切れています。アカウント画面から再接続してください。`;
    case "PERMISSION":
      return `${name}への投稿権限がありません。アカウント画面から再接続し、投稿の許可を与えてください。`;
    case "CONTENT":
      return `${name}の投稿ルールに合わない内容です。文字数や内容を見直してください。`;
    case "RATE_LIMIT":
      return `${name}の投稿回数の上限に達しました。しばらくしてから自動で再試行します。`;
    case "TRANSIENT":
      return `${name}に一時的につながりませんでした。自動で再試行します。`;
    case "NOT_IMPLEMENTED":
      return `${name}への実際の投稿はまだ対応していません（現在はMockモードのみ対応）。`;
    default:
      return `${name}への投稿に失敗しました。時間をおいて再度お試しください。`;
  }
}
