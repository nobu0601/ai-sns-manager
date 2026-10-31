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
  // 文字数の数え方。X は日本語などを2文字として数える
  lengthCounting: "codepoints" | "x-weighted";
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
  // mediaUrls の種類（未指定なら URL から推測する）
  mediaType?: import("@prisma/client").MediaType | null;
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

// 分析（Phase 4）：SNS から取得した投稿の数値。SNS が返さない指標は null（0 と区別する）
export interface PostMetricValues {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  // SNS API の数値（項目名は SNS のまま）
  raw: Record<string, number>;
}

// 数値を取得する投稿（SNS 上の投稿ID）
export interface MetricsTarget {
  externalPostId: string;
}

// 投稿ごとの取得結果。投稿が削除されているなど、個別に取れなかったものは error に理由を入れる
export type PostMetricsResult = Map<string, PostMetricValues | { error: string }>;

// SNS 上にある、そのアカウントの過去の投稿（AI が内容を重ねないために読む）
export interface RecentPost {
  externalPostId: string;
  text: string;
  publishedAt: Date;
  permalink?: string | null;
}

// 各SNSは必ずこのインターフェースを実装する。新しいSNSの追加もこれを実装するだけでよい。
export interface SocialPlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: SocialPlatformCapabilities;

  // 入力されたキーでSNSに問い合わせ、有効ならアカウント情報を返す（無効なら SocialPublishError）
  verifyCredentials(credentials: PlatformCredentials): Promise<VerifiedAccount>;

  createPost(post: PlatformPost, credentials: PlatformCredentials, account: VerifiedAccount): Promise<PublishedPost>;

  validatePost(post: PlatformPost): Promise<ValidationResult>;

  // 分析：投稿の数値を取得する。アカウント全体で取れない（権限・プラン不足など）ときは SocialPublishError
  fetchPostMetrics(targets: MetricsTarget[], credentials: PlatformCredentials, account: VerifiedAccount): Promise<PostMetricsResult>;

  // 分析：現在のフォロワー数
  fetchFollowerCount(credentials: PlatformCredentials, account: VerifiedAccount): Promise<number>;

  // 過去の投稿（新しい順・最大 limit 件）。本文を取得できない SNS は空の配列を返す
  fetchRecentPosts(credentials: PlatformCredentials, account: VerifiedAccount, limit: number): Promise<RecentPost[]>;
}
