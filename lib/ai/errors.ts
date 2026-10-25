// AI 生成のエラー。ユーザー向けの文と、ログ用の詳細を分けて持つ
export type AIErrorKind = "NOT_CONFIGURED" | "AUTH" | "RATE_LIMIT" | "REFUSAL" | "INVALID_OUTPUT" | "UNAVAILABLE";

const MESSAGES: Record<AIErrorKind, string> = {
  NOT_CONFIGURED: "AIのAPIキーが設定されていません。サーバーの .env に ANTHROPIC_API_KEY を設定してください。",
  AUTH: "AIのAPIキーが正しくないか、権限がありません。ANTHROPIC_API_KEY を確認してください。",
  RATE_LIMIT: "AIが混み合っています。少し時間をおいてから、もう一度お試しください。",
  REFUSAL: "この内容では投稿案を作れませんでした。テーマの書き方を変えてお試しください。",
  INVALID_OUTPUT: "投稿案をうまく作れませんでした。もう一度お試しください。",
  UNAVAILABLE: "AIに接続できませんでした。時間をおいてもう一度お試しください。",
};

export class AIError extends Error {
  constructor(
    public readonly kind: AIErrorKind,
    public readonly detail?: string,
  ) {
    super(MESSAGES[kind]);
    this.name = "AIError";
  }
}
