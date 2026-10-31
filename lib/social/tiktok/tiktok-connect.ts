import { randomBytes } from "node:crypto";
import { logger } from "@/lib/logging/logger";
import { saveOAuthAccount } from "../account-service";
import { toSocialError } from "../errors";
import { isMockMode } from "../registry";
import type { PlatformCredentials } from "../types";
import { TikTokAdapter } from "./tiktok-adapter";
import { TIKTOK_AUTHORIZE_URL, TIKTOK_SCOPES, exchangeCode, tiktokClientConfig, type TikTokCredentials } from "./tiktok-api";

// 「TikTokでログインして連携」の流れ（Login Kit for Web）：
//   1. /api/social/tiktok/authorize … state を Cookie に入れて TikTok の許可画面へ
//   2. /api/social/tiktok/callback  … state を確かめ、code をトークンに交換し、アカウントを保存する
export const TIKTOK_STATE_COOKIE = "tiktok_oauth_state";

export function tiktokRedirectUri(baseUrl: string): string {
  return `${baseUrl}/api/social/tiktok/callback`;
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export function authorizeUrl(clientKey: string, redirectUri: string, state: string): string {
  const qs = new URLSearchParams({ client_key: clientKey, response_type: "code", scope: TIKTOK_SCOPES.join(","), redirect_uri: redirectUri, state });
  return `${TIKTOK_AUTHORIZE_URL}?${qs}`;
}

export type ConnectResult = { ok: true; accountName: string } | { ok: false; reason: "not_configured" | "denied" | "failed" };

// 許可後に戻ってきた code でアカウントを連携する
export async function connectTikTok(userId: string, code: string, redirectUri: string): Promise<ConnectResult> {
  const config = tiktokClientConfig();
  if (!config) return { ok: false, reason: "not_configured" };
  try {
    const { scope, ...credentials } = await exchangeCode(config, code, redirectUri);
    if (!scope.split(",").includes("video.publish")) {
      logger.warn("social.tiktok.scope_missing", { userId, scope });
      return { ok: false, reason: "denied" };
    }
    const verified = await new TikTokAdapter().verifyCredentials(credentials as unknown as PlatformCredentials);
    const account = await saveOAuthAccount(userId, "TIKTOK", credentials as unknown as PlatformCredentials, {
      ...verified,
      tokenExpiresAt: new Date(credentials.refreshTokenExpiresAt),
    });
    return { ok: true, accountName: account.accountName };
  } catch (err) {
    const e = toSocialError(err, "TIKTOK");
    logger.warn("social.tiktok.connect_failed", { userId, kind: e.kind, error: e.message });
    return { ok: false, reason: "failed" };
  }
}

// Mock モード：TikTok に問い合わせず、架空のアカウントを連携する（開発・テスト用）
export async function connectMockTikTok(userId: string): Promise<ConnectResult> {
  if (!isMockMode()) return { ok: false, reason: "failed" };
  const id = randomBytes(4).toString("hex");
  const far = new Date(Date.now() + 365 * 86400_000).toISOString();
  const credentials: TikTokCredentials = { accessToken: `mock-${id}`, refreshToken: `mock-r-${id}`, openId: `mock-tiktok-${id}`, accessTokenExpiresAt: far, refreshTokenExpiresAt: far };
  const account = await saveOAuthAccount(userId, "TIKTOK", credentials as unknown as PlatformCredentials, {
    accountName: `@mock_tiktok_${id.slice(0, 4)}`,
    externalAccountId: credentials.openId,
  });
  return { ok: true, accountName: account.accountName };
}
