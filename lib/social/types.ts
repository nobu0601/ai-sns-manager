import type { Platform } from "@prisma/client";

export type { Platform };

// SNSごとに「できること」。API仕様は変わるため、コードの分岐はこの値を見て行う。
export interface SocialPlatformCapabilities {
  textPost: boolean;
  imagePost: boolean;
  videoPost: boolean;
  scheduledPost: boolean; // SNS側のネイティブ予約投稿（本アプリはキューで予約するため必須ではない）
  analytics: boolean;
  deletePost: boolean;
  // 投稿にメディアが必須か（Instagram は画像/動画が必須）
  requiresMedia: boolean;
  // 1投稿の最大文字数。null は制限不明。値は各 Adapter 実装時に公式ドキュメントで再確認する
  maxTextLength: number | null;
}

// ユーザーが入力する各SNSのキー（平文。保存時は暗号化する）。
// X: OAuth 1.0a のユーザーコンテキスト（開発者ポータルで発行する4つの値）
// Threads / Instagram: 長期アクセストークン
export type XCredentials = { apiKey: string; apiSecret: string; accessToken: string; accessTokenSecret: string };
export type TokenCredentials = { accessToken: string };
export type PlatformCredentials = XCredentials | TokenCredentials;

// キー確認で分かったアカウント情報
export interface VerifiedAccount {
  accountName: string;
  externalAccountId: string;
  tokenExpiresAt?: Date;
}

// Adapter に渡す投稿内容
export interface PlatformPost {
  platform: Platform;
  content: string;
  mediaUrls?: string[];
  // 二重投稿防止キー（postId:socialAccountId）。SNS側が対応していれば渡す
  idempotencyKey: string;
}

export interface PublishedPost {
  externalPostId: string;
  externalUrl?: string;
  publishedAt: Date;
  // SNS APIの生レスポンス（ログ用。秘密情報は含めないこと）
  raw?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// 各SNSは必ずこのインターフェースを実装する。新しいSNSの追加もこれを実装するだけでよい。
export interface SocialPlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: SocialPlatformCapabilities;

  // 入力されたキーでSNSに問い合わせ、有効ならアカウント情報を返す（無効なら SocialPublishError）
  verifyCredentials(credentials: PlatformCredentials): Promise<VerifiedAccount>;

  createPost(post: PlatformPost, credentials: PlatformCredentials, account: VerifiedAccount): Promise<PublishedPost>;

  validatePost(post: PlatformPost): Promise<ValidationResult>;
}
