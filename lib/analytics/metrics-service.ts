import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { startOfJstDay } from "@/lib/datetime";
import { metricsMessageFor } from "@/lib/errors/user-messages";
import { ServiceError } from "@/lib/errors/service-error";
import { logger } from "@/lib/logging/logger";
import { getJobDispatcher } from "@/lib/queue/jobs";
import { readCredentials } from "@/lib/social/account-service";
import { toSocialError } from "@/lib/social/errors";
import { getAdapter, isMockMode } from "@/lib/social/registry";

// 数値を取り直す対象：投稿から30日以内（それより古い投稿の数値はほとんど変わらないため）
export const METRICS_WINDOW_DAYS = 30;

export interface CollectSummary {
  accounts: number;
  posts: number;
  errors: { accountId: string; message: string }[];
}

// SNS から投稿の数値とフォロワー数を取得して保存する（Worker から呼ぶ）。
// userId を省略すると全ユーザーが対象（6時間ごとの自動取得）
export async function collectMetrics({ userId, now = new Date() }: { userId?: string; now?: Date } = {}): Promise<CollectSummary> {
  const accounts = await prisma.socialAccount.findMany({
    where: { ...(userId ? { userId } : {}), status: "CONNECTED", isMock: isMockMode() },
  });
  const since = new Date(now.getTime() - METRICS_WINDOW_DAYS * 86_400_000);
  const summary: CollectSummary = { accounts: accounts.length, posts: 0, errors: [] };

  for (const account of accounts) {
    const adapter = getAdapter(account.platform);
    const credentials = readCredentials(account.credentialsEncrypted);
    const verified = { accountName: account.accountName, externalAccountId: account.externalAccountId };
    const problems: string[] = [];

    const targets = await prisma.postPlatform.findMany({
      where: { socialAccountId: account.id, status: "PUBLISHED", externalPostId: { not: null }, publishedAt: { gte: since } },
      select: { id: true, externalPostId: true },
    });

    // 投稿の数値
    if (targets.length > 0) {
      try {
        const results = await adapter.fetchPostMetrics(
          targets.map((t) => ({ externalPostId: t.externalPostId! })),
          credentials,
          verified,
        );
        for (const t of targets) {
          const value = results.get(t.externalPostId!);
          if (!value) continue;
          if ("error" in value) {
            logger.info("metrics.post_unavailable", { postPlatformId: t.id, error: value.error });
            continue;
          }
          const data = {
            platform: account.platform,
            views: value.views,
            reach: value.reach,
            likes: value.likes,
            comments: value.comments,
            shares: value.shares,
            saves: value.saves,
            clicks: value.clicks,
            raw: value.raw as Prisma.InputJsonValue,
            fetchedAt: now,
          };
          await prisma.postMetric.upsert({ where: { postPlatformId: t.id }, create: { postPlatformId: t.id, ...data }, update: data });
          summary.posts++;
        }
      } catch (err) {
        const e = toSocialError(err, account.platform);
        logger.warn("metrics.posts_failed", { accountId: account.id, platform: account.platform, kind: e.kind, error: e.message });
        problems.push(metricsMessageFor(e.kind, account.platform));
      }
    }

    // フォロワー数（日本時間の1日に1件。同じ日は最新の値で上書き）
    try {
      const followers = await adapter.fetchFollowerCount(credentials, verified);
      const date = startOfJstDay(now);
      await prisma.accountMetric.upsert({
        where: { socialAccountId_date: { socialAccountId: account.id, date } },
        create: { socialAccountId: account.id, date, followers, fetchedAt: now },
        update: { followers, fetchedAt: now },
      });
    } catch (err) {
      const e = toSocialError(err, account.platform);
      logger.warn("metrics.followers_failed", { accountId: account.id, platform: account.platform, kind: e.kind, error: e.message });
      const message = metricsMessageFor(e.kind, account.platform);
      if (!problems.includes(message)) problems.push(message);
    }

    const metricsError = problems.length > 0 ? problems.join(" ") : null;
    await prisma.socialAccount.update({ where: { id: account.id }, data: { metricsError, metricsCheckedAt: now } });
    if (metricsError) summary.errors.push({ accountId: account.id, message: metricsError });
  }

  logger.info("metrics.collected", { userId: userId ?? "all", accounts: summary.accounts, posts: summary.posts, errors: summary.errors.length });
  return summary;
}

// 画面の「数値を更新」：Worker に取得を依頼する
export async function requestMetricsRefresh(userId: string): Promise<void> {
  try {
    await getJobDispatcher().enqueueMetricsRefresh(userId);
  } catch (err) {
    logger.error("metrics.enqueue_failed", { userId, error: err instanceof Error ? err.message : String(err) });
    throw new ServiceError(503, "数値の取得を開始できませんでした。時間をおいてもう一度お試しください。", "QUEUE_UNAVAILABLE");
  }
}
