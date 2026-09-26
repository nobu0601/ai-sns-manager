import { randomBytes } from "node:crypto";
import type { Platform, SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { decrypt, encrypt } from "@/lib/encryption/crypto";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { ServiceError, notFound } from "@/lib/errors/service-error";
import { logger } from "@/lib/logging/logger";
import { SocialPublishError } from "./errors";
import { getAdapter, isMockMode } from "./registry";
import type { ConnectedAccount } from "./types";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// 画面・APIに返すアカウント情報（トークンは絶対に含めない）
export type SocialAccountView = Pick<
  SocialAccount,
  "id" | "platform" | "accountName" | "status" | "isMock" | "lastCheckedAt" | "tokenExpiresAt" | "brandId" | "createdAt"
>;

function toView(a: SocialAccount): SocialAccountView {
  return {
    id: a.id,
    platform: a.platform,
    accountName: a.accountName,
    status: a.status,
    isMock: a.isMock,
    lastCheckedAt: a.lastCheckedAt,
    tokenExpiresAt: a.tokenExpiresAt,
    brandId: a.brandId,
    createdAt: a.createdAt,
  };
}

export async function listAccounts(userId: string): Promise<SocialAccountView[]> {
  const rows = await prisma.socialAccount.findMany({ where: { userId }, orderBy: { platform: "asc" } });
  return rows.map(toView);
}

export async function startConnect(userId: string, platform: Platform, redirectUri: string): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const adapter = getAdapter(platform);
  const request = await adapter.getAuthorizationUrl({ state, redirectUri });
  await prisma.oAuthState.create({
    data: {
      state,
      userId,
      platform,
      codeVerifier: request.codeVerifier ? encrypt(request.codeVerifier) : null,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    },
  });
  logger.info("social.connect.start", { userId, platform });
  return request.url;
}

export async function completeConnect(input: {
  userId: string;
  platform: Platform;
  state: string;
  code: string;
  redirectUri: string;
}): Promise<SocialAccountView> {
  const saved = await prisma.oAuthState.findUnique({ where: { state: input.state } });
  // state は一度きり。検証前に削除して再利用を防ぐ
  if (saved) await prisma.oAuthState.delete({ where: { id: saved.id } });
  if (!saved || saved.userId !== input.userId || saved.platform !== input.platform || saved.expiresAt < new Date()) {
    throw new ServiceError(400, "接続の有効期限が切れました。もう一度お試しください。", "INVALID_STATE");
  }

  const adapter = getAdapter(input.platform);
  const connected = await adapter.handleCallback({
    code: input.code,
    redirectUri: input.redirectUri,
    codeVerifier: saved.codeVerifier ? decrypt(saved.codeVerifier) : undefined,
  });

  const data = {
    accountName: connected.accountName,
    accessTokenEncrypted: encrypt(connected.accessToken),
    refreshTokenEncrypted: connected.refreshToken ? encrypt(connected.refreshToken) : null,
    tokenExpiresAt: connected.tokenExpiresAt ?? null,
    scopes: connected.scopes ?? [],
    status: "CONNECTED" as const,
    isMock: isMockMode(),
    lastCheckedAt: new Date(),
  };
  const account = await prisma.socialAccount.upsert({
    where: {
      userId_platform_externalAccountId: {
        userId: input.userId,
        platform: input.platform,
        externalAccountId: connected.externalAccountId,
      },
    },
    create: { userId: input.userId, platform: input.platform, externalAccountId: connected.externalAccountId, ...data },
    update: data,
  });
  logger.info("social.connect.success", { userId: input.userId, platform: input.platform, accountId: account.id });
  return toView(account);
}

// 「切断」はトークンごとレコードを削除する（トークンを残さない）
export async function disconnectAccount(userId: string, accountId: string): Promise<void> {
  const { count } = await prisma.socialAccount.deleteMany({ where: { id: accountId, userId } });
  if (count === 0) throw notFound("SNSアカウント");
  logger.info("social.disconnect", { userId, accountId });
}

// 投稿に使うアカウントを取得し、トークンを復号する
export async function getPublishingAccount(
  userId: string,
  platform: Platform,
  brandId?: string | null,
): Promise<{ id: string; connected: ConnectedAccount }> {
  const candidates = await prisma.socialAccount.findMany({
    where: { userId, platform, status: "CONNECTED" },
    orderBy: { updatedAt: "desc" },
  });
  // ブランドに紐付いたアカウントを優先し、無ければブランド未指定のアカウントを使う
  const account =
    candidates.find((a) => brandId && a.brandId === brandId) ?? candidates.find((a) => a.brandId === null) ?? candidates[0];
  if (!account) {
    throw new SocialPublishError("AUTH", platform, `${PLATFORM_LABELS[platform]} account is not connected`);
  }
  if (account.isMock !== isMockMode()) {
    throw new SocialPublishError(
      "AUTH",
      platform,
      `account mode mismatch (isMock=${account.isMock}, mode=${process.env.SOCIAL_PROVIDER_MODE ?? "mock"})`,
    );
  }
  return {
    id: account.id,
    connected: {
      platform,
      accountName: account.accountName,
      externalAccountId: account.externalAccountId,
      accessToken: decrypt(account.accessTokenEncrypted),
      refreshToken: account.refreshTokenEncrypted ? decrypt(account.refreshTokenEncrypted) : undefined,
      tokenExpiresAt: account.tokenExpiresAt ?? undefined,
      scopes: account.scopes,
    },
  };
}

export async function markAccountExpired(accountId: string): Promise<void> {
  await prisma.socialAccount.update({ where: { id: accountId }, data: { status: "EXPIRED", lastCheckedAt: new Date() } });
}

export async function connectedPlatforms(userId: string): Promise<Set<Platform>> {
  const rows = await prisma.socialAccount.findMany({
    where: { userId, status: "CONNECTED", isMock: isMockMode() },
    select: { platform: true },
  });
  return new Set(rows.map((r) => r.platform));
}
