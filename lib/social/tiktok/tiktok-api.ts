import { SocialPublishError } from "../errors";
import { callApi, type FetchLike } from "../http";

// TikTok API の共通処理。仕様は TikTok for Developers の公式ドキュメントで確認：
//   認可   https://www.tiktok.com/v2/auth/authorize/?client_key&response_type=code&scope&redirect_uri&state（Login Kit for Web）
//   トークン POST https://open.tiktokapis.com/v2/oauth/token/（form。grant_type=authorization_code / refresh_token）
//          → access_token（24時間）, refresh_token（365日）, open_id, expires_in, refresh_expires_in, scope
//   エラーは {error, error_description, log_id}（トークン）/ {error: {code, message, log_id}}（その他。code が "ok" 以外は失敗）
export const TIKTOK_API = "https://open.tiktokapis.com";
export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
// 投稿に必要な権限。user.info.basic はログインに必須の基本権限
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish"];

export type TikTokCredentials = {
  accessToken: string;
  refreshToken: string;
  openId: string;
  // ISO 日時
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export function tiktokClientConfig(): { clientKey: string; clientSecret: string } | null {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  return clientKey && clientSecret ? { clientKey, clientSecret } : null;
}

function toCredentials(res: TokenResponse, now: Date): TikTokCredentials & { scope: string } {
  if (!res.access_token || !res.refresh_token || !res.open_id) {
    throw new SocialPublishError("AUTH", "TIKTOK", `token error: ${res.error ?? "no token"}`, { error: res.error, error_description: res.error_description });
  }
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    openId: res.open_id,
    accessTokenExpiresAt: new Date(now.getTime() + (res.expires_in ?? 86400) * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now.getTime() + (res.refresh_expires_in ?? 365 * 86400) * 1000).toISOString(),
    scope: res.scope ?? "",
  };
}

async function tokenRequest(fetchImpl: FetchLike, params: Record<string, string>, now: Date) {
  const res = await callApi<TokenResponse>("TIKTOK", fetchImpl, `${TIKTOK_API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return toCredentials(res, now);
}

// 認可コードをトークンに交換する
export function exchangeCode(
  config: { clientKey: string; clientSecret: string },
  code: string,
  redirectUri: string,
  { fetchImpl = fetch, now = new Date() }: { fetchImpl?: FetchLike; now?: Date } = {},
) {
  return tokenRequest(
    fetchImpl,
    { client_key: config.clientKey, client_secret: config.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri },
    now,
  );
}

// アクセストークンを更新する（利用者の操作は不要）。新しい refresh_token が返ったらそれを使う
export function refreshTokens(
  config: { clientKey: string; clientSecret: string },
  refreshToken: string,
  { fetchImpl = fetch, now = new Date() }: { fetchImpl?: FetchLike; now?: Date } = {},
) {
  return tokenRequest(
    fetchImpl,
    { client_key: config.clientKey, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken },
    now,
  );
}

// 期限の5分前になったら更新する
export function needsRefresh(c: TikTokCredentials, now: Date = new Date()): boolean {
  return new Date(c.accessTokenExpiresAt).getTime() - now.getTime() < 5 * 60 * 1000;
}

// open.tiktokapis.com の JSON API。200 でも error.code が "ok" 以外なら失敗として扱う
export async function tiktokJson<T>(fetchImpl: FetchLike, path: string, accessToken: string, body?: unknown): Promise<T> {
  const res = await callApi<T & { error?: { code?: string; message?: string } }>("TIKTOK", fetchImpl, `${TIKTOK_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const code = res.error?.code;
  if (code && code !== "ok") {
    const kind = code === "access_token_invalid" ? "AUTH" : code.startsWith("scope") || code.startsWith("unaudited") ? "PERMISSION" : code.startsWith("rate_limit") ? "RATE_LIMIT" : "CONTENT";
    throw new SocialPublishError(kind, "TIKTOK", `TikTok error: ${code}`, res.error);
  }
  return res;
}
