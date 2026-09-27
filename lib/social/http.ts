import type { Platform } from "@prisma/client";
import { SocialPublishError, type SocialErrorKind } from "./errors";

export type FetchLike = typeof fetch;

const TIMEOUT_MS = 20_000;

// SNS API を呼ぶ共通処理。HTTPステータスとエラー内容から SocialErrorKind に分類する。
// 例外メッセージにはアクセストークンを含めない（URLのクエリは伏せる）
export async function callApi<T>(
  platform: Platform,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const safeUrl = url.split("?")[0];
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new SocialPublishError("TRANSIENT", platform, `network error: ${safeUrl} ${err instanceof Error ? err.message : ""}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 500);
  }
  if (!res.ok) {
    throw new SocialPublishError(classifyHttpError(res.status, body), platform, `HTTP ${res.status} ${safeUrl}`, body);
  }
  return body as T;
}

export function classifyHttpError(status: number, body: unknown): SocialErrorKind {
  // Meta（Threads / Instagram）は無効・期限切れトークンを error.code 190 で返す
  const metaCode = (body as { error?: { code?: number } } | null)?.error?.code;
  if (metaCode === 190) return "AUTH";
  if (status === 401) return "AUTH";
  if (status === 403) return "PERMISSION";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "TRANSIENT";
  if (status >= 400) return "CONTENT";
  return "UNKNOWN";
}
