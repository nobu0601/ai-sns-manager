// 画像・動画生成のエラー。ユーザー向けの文と、ログ用の詳細を分けて持つ
export type MediaErrorKind = "NOT_CONFIGURED" | "AUTH" | "RATE_LIMIT" | "REJECTED" | "UNAVAILABLE";

const MESSAGES: Record<MediaErrorKind, string> = {
  NOT_CONFIGURED: "画像・動画生成のAPIキーが設定されていません。サーバーの .env に FAL_KEY を設定してください。",
  AUTH: "画像・動画生成のAPIキーが正しくないか、残高・権限がありません。FAL_KEY と fal.ai の契約を確認してください。",
  RATE_LIMIT: "画像・動画生成が混み合っています。少し時間をおいてから、もう一度お試しください。",
  REJECTED: "この内容では画像・動画を作れませんでした。イメージの書き方を変えてお試しください。",
  UNAVAILABLE: "画像・動画生成に失敗しました。時間をおいてもう一度お試しください。",
};

export class MediaGenerationError extends Error {
  constructor(
    public readonly kind: MediaErrorKind,
    public readonly detail?: string,
  ) {
    super(MESSAGES[kind]);
    this.name = "MediaGenerationError";
  }
}
