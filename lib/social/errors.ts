import type { Platform } from "@prisma/client";

// SNS投稿エラーの分類。リトライ可否はこの分類で決める。
export type SocialErrorKind =
  | "AUTH" // トークン切れ・無効（再認証が必要）
  | "PERMISSION" // 権限不足
  | "CONTENT" // 投稿内容がSNSの仕様に合わない
  | "RATE_LIMIT" // レート制限
  | "TRANSIENT" // 一時的な障害（ネットワーク・5xx）
  | "NOT_IMPLEMENTED"
  | "UNKNOWN";

const NON_RETRYABLE: SocialErrorKind[] = ["AUTH", "PERMISSION", "CONTENT", "NOT_IMPLEMENTED"];

export class SocialPublishError extends Error {
  constructor(
    public readonly kind: SocialErrorKind,
    public readonly platform: Platform,
    message: string,
    // SNS APIの元エラー（詳細ログ用）
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "SocialPublishError";
  }

  get retryable(): boolean {
    return !NON_RETRYABLE.includes(this.kind);
  }
}

export function toSocialError(err: unknown, platform: Platform): SocialPublishError {
  if (err instanceof SocialPublishError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new SocialPublishError("UNKNOWN", platform, message, err);
}

// SNS API のエラー応答から、原因の調査に使う項目だけを取り出す（ログ用。トークンは含まれない項目のみ）
// Meta: {error: {message, type, code, error_subcode}} / X: {title, detail, type}
export function apiErrorSummary(detail: unknown): Record<string, unknown> | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const body = detail as { error?: Record<string, unknown>; title?: unknown; detail?: unknown; type?: unknown };
  if (body.error && typeof body.error === "object") {
    const { message, type, code, error_subcode } = body.error;
    return { message, type, code, error_subcode };
  }
  if (body.title || body.detail) return { title: body.title, detail: body.detail, type: body.type };
  return undefined;
}
