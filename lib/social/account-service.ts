import type { Platform, SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { decrypt, encrypt } from "@/lib/encryption/crypto";
import { PLATFORM_LABELS, userMessageFor } from "@/lib/errors/user-messages";
import { ServiceError, notFound } from "@/lib/errors/service-error";
import { logger } from "@/lib/logging/logger";
import { CREDENTIAL_FIELDS, credentialHint } from "./credential-fields";
import { SocialPublishError, toSocialError } from "./errors";
import { getAdapter, isMockMode } from "./registry";
import type { PlatformCredentials, VerifiedAccount } from "./types";

// 画面・APIに返すアカウント情報（キーは絶対に含めない）
export type SocialAccountView = Pick<
  SocialAccount,
  | "id"
  | "platform"
  | "accountName"
  | "label"
  | "credentialHint"
  | "status"
  | "isMock"
  | "lastCheckedAt"
  | "lastError"
  | "brandId"
  | "createdAt"
>;

function toView(a: SocialAccount): SocialAccountView {
  return {
    id: a.id,
    platform: a.platform,
    accountName: a.accountName,
    label: a.label,
    credentialHint: a.credentialHint,
    status: a.status,
    isMock: a.isMock,
    lastCheckedAt: a.lastCheckedAt,
    lastError: a.lastError,
    brandId: a.brandId,
    createdAt: a.createdAt,
  };
}

// 画面の表示名（ラベルがあれば「ラベル（@name）」）
export function accountDisplayName(a: { label: string; accountName: string }): string {
  return a.label ? `${a.label}（${a.accountName}）` : a.accountName;
}

// 入力値を SNS ごとの必須項目に揃える。足りなければ 400
export function normalizeCredentials(platform: Platform, input: Record<string, string>): PlatformCredentials {
  const fields = CREDENTIAL_FIELDS[platform];
  const missing = fields.filter((f) => !input[f.key]?.trim()).map((f) => `${f.label}を入力してください`);
  if (missing.length > 0) throw new ServiceError(400, "キーを入力してください", "VALIDATION_ERROR", missing);
  return Object.fromEntries(fields.map((f) => [f.key, input[f.key].trim()])) as PlatformCredentials;
}

// 保存形式は暗号化した JSON。旧形式（OAuth のアクセストークンのみ）は { accessToken } として読む
export function readCredentials(encrypted: string): PlatformCredentials {
  const plain = decrypt(encrypted);
  try {
    const parsed = JSON.parse(plain);
    if (parsed && typeof parsed === "object") return parsed as PlatformCredentials;
  } catch {
    // 旧形式
  }
  return { accessToken: plain };
}

// キーをSNSに問い合わせて確認する。無効ならユーザー向けの文で 400
async function verify(platform: Platform, credentials: PlatformCredentials): Promise<VerifiedAccount> {
  try {
    return await getAdapter(platform).verifyCredentials(credentials);
  } catch (err) {
    const e = toSocialError(err, platform);
    logger.warn("social.verify.failed", { platform, kind: e.kind, error: e.message });
    const message =
      e.kind === "AUTH" || e.kind === "PERMISSION"
        ? `${PLATFORM_LABELS[platform]}のキーを確認できませんでした。値に誤りがないか、投稿の権限があるかを確認してください。`
        : userMessageFor(e.kind, platform);
    throw new ServiceError(400, message, "INVALID_CREDENTIALS");
  }
}

export async function listAccounts(userId: string): Promise<SocialAccountView[]> {
  const rows = await prisma.socialAccount.findMany({
    where: { userId },
    orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

async function assertBrandOwned(userId: string, brandId: string): Promise<void> {
  const brand = await prisma.brand.findFirst({ where: { id: brandId, userId }, select: { id: true } });
  if (!brand) throw notFound("ブランド");
}

async function findOwned(userId: string, accountId: string): Promise<SocialAccount> {
  const account = await prisma.socialAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw notFound("SNSアカウント");
  return account;
}

// 確認済みのキーを保存するときの共通項目
function credentialData(credentials: PlatformCredentials, verified: VerifiedAccount) {
  return {
    accountName: verified.accountName,
    credentialsEncrypted: encrypt(JSON.stringify(credentials)),
    credentialHint: credentialHint(credentials.accessToken),
    tokenExpiresAt: verified.tokenExpiresAt ?? null,
    status: "CONNECTED" as const,
    isMock: isMockMode(),
    lastCheckedAt: new Date(),
    lastError: null,
  };
}

// アカウントを追加する（同じSNSアカウントのキーを入力し直した場合は更新）
export async function connectAccount(
  userId: string,
  platform: Platform,
  input: { credentials: Record<string, string>; label?: string; brandId?: string | null },
): Promise<SocialAccountView> {
  const credentials = normalizeCredentials(platform, input.credentials);
  if (input.brandId) await assertBrandOwned(userId, input.brandId);
  const verified = await verify(platform, credentials);

  const data = {
    ...credentialData(credentials, verified),
    ...(input.label !== undefined ? { label: input.label.trim() } : {}),
    ...(input.brandId !== undefined ? { brandId: input.brandId || null } : {}),
  };
  const account = await prisma.socialAccount.upsert({
    where: {
      userId_platform_externalAccountId: { userId, platform, externalAccountId: verified.externalAccountId },
    },
    create: { userId, platform, externalAccountId: verified.externalAccountId, ...data },
    update: data,
  });
  logger.info("social.connect.success", { userId, platform, accountId: account.id });
  return toView(account);
}

// ラベル・ブランドの変更、キーの差し替え（再認証）
export async function updateAccount(
  userId: string,
  accountId: string,
  input: { credentials?: Record<string, string>; label?: string; brandId?: string | null },
): Promise<SocialAccountView> {
  const account = await findOwned(userId, accountId);
  if (input.brandId) await assertBrandOwned(userId, input.brandId);

  let keyData = {};
  if (input.credentials) {
    const credentials = normalizeCredentials(account.platform, input.credentials);
    const verified = await verify(account.platform, credentials);
    // 別のアカウントのキーに差し替えると、予約済みの投稿先が変わってしまうため拒否する
    if (verified.externalAccountId !== account.externalAccountId) {
      throw new ServiceError(
        400,
        `入力されたキーは ${verified.accountName} のものです。別のアカウントは「アカウントを追加」から登録してください。`,
        "ACCOUNT_MISMATCH",
      );
    }
    keyData = credentialData(credentials, verified);
  }
  const updated = await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      ...keyData,
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.brandId !== undefined ? { brandId: input.brandId || null } : {}),
    },
  });
  return toView(updated);
}

// 保存済みのキーが今も有効かを確認する
export async function recheckAccount(userId: string, accountId: string): Promise<SocialAccountView> {
  const account = await findOwned(userId, accountId);
  if (account.isMock !== isMockMode()) {
    throw new ServiceError(409, "現在のモードでは確認できないアカウントです。キーを入力し直してください。", "MODE_MISMATCH");
  }
  try {
    const verified = await verify(account.platform, readCredentials(account.credentialsEncrypted));
    const updated = await prisma.socialAccount.update({
      where: { id: account.id },
      data: { accountName: verified.accountName, status: "CONNECTED", lastCheckedAt: new Date(), lastError: null },
    });
    return toView(updated);
  } catch (err) {
    const message = err instanceof ServiceError ? err.message : "接続を確認できませんでした";
    await markAccountExpired(account.id, message);
    throw err;
  }
}

// 「切断」はキーごとレコードを削除する（キーを残さない）。投稿履歴はアカウント名で残る
export async function disconnectAccount(userId: string, accountId: string): Promise<void> {
  const { count } = await prisma.socialAccount.deleteMany({ where: { id: accountId, userId } });
  if (count === 0) throw notFound("SNSアカウント");
  logger.info("social.disconnect", { userId, accountId });
}

// 投稿に使うアカウントを取得し、キーを復号する
export async function getPublishingAccount(
  userId: string,
  platform: Platform,
  accountId: string | null,
): Promise<{ id: string; credentials: PlatformCredentials; account: VerifiedAccount }> {
  const account = accountId ? await prisma.socialAccount.findFirst({ where: { id: accountId, userId } }) : null;
  if (!account) throw new SocialPublishError("AUTH", platform, "target account was disconnected");
  if (account.status !== "CONNECTED") {
    throw new SocialPublishError("AUTH", platform, `account status is ${account.status}`);
  }
  if (account.isMock !== isMockMode()) {
    throw new SocialPublishError("AUTH", platform, `account mode mismatch (isMock=${account.isMock})`);
  }
  return {
    id: account.id,
    credentials: readCredentials(account.credentialsEncrypted),
    account: { accountName: account.accountName, externalAccountId: account.externalAccountId },
  };
}

export async function markAccountExpired(accountId: string, message: string): Promise<void> {
  await prisma.socialAccount.updateMany({
    where: { id: accountId },
    data: { status: "EXPIRED", lastCheckedAt: new Date(), lastError: message },
  });
}

// 投稿先に選べるアカウント（接続済み・現在のモードのもの）
export async function listPostableAccounts(userId: string) {
  return prisma.socialAccount.findMany({
    where: { userId, status: "CONNECTED", isMock: isMockMode() },
    select: { id: true, platform: true, accountName: true, label: true, brandId: true },
    orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
  });
}
