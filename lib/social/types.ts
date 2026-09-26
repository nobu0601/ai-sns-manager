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

// OAuth で接続したアカウント情報（トークンは平文。保存時に暗号化する）
export interface ConnectedAccount {
  platform: Platform;
  accountName: string;
  externalAccountId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes?: string[];
}

// Adapter に渡す投稿内容
export interface PlatformPost {
  platform: Platform;
  content: string;
  mediaUrls?: string[];
  // 二重投稿防止キー（postId:platform）。SNS側が対応していれば渡す
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

export interface AuthorizationRequest {
  url: string;
  state: string;
  codeVerifier?: string;
}

// 各SNSは必ずこのインターフェースを実装する。新しいSNSの追加もこれを実装するだけでよい。
export interface SocialPlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: SocialPlatformCapabilities;

  getAuthorizationUrl(input: { state: string; redirectUri: string }): Promise<AuthorizationRequest>;

  handleCallback(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<ConnectedAccount>;

  refreshToken(account: ConnectedAccount): Promise<ConnectedAccount>;

  createPost(post: PlatformPost, account: ConnectedAccount): Promise<PublishedPost>;

  deletePost?(externalPostId: string, account: ConnectedAccount): Promise<void>;

  validatePost(post: PlatformPost): Promise<ValidationResult>;
}
