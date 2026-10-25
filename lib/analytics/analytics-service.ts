import { prisma } from "@/lib/database/prisma";
import { accountDisplayName } from "@/lib/social/account-service";
import { isMockMode } from "@/lib/social/registry";
import {
  METRIC_KEYS,
  byPillar,
  byPlatform,
  byTimeBand,
  byWeekday,
  followerChange,
  totalsOf,
  type Metrics,
  type PostRow,
} from "./aggregate";

export const ANALYTICS_PERIODS = [7, 30, 90] as const;

// 分析画面のデータ。brandId を指定するとそのブランドの投稿だけを集計する
export async function getAnalytics(
  userId: string,
  { brandId, days = 30, now = new Date(), limit }: { brandId?: string | null; days?: number; now?: Date; limit?: number } = {},
) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const published = await prisma.postPlatform.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { gte: since, lte: now },
      post: { userId, ...(brandId ? { brandId } : {}) },
    },
    include: { post: { select: { id: true, title: true, topic: true, contentPillar: true } }, metric: true },
    orderBy: { publishedAt: "desc" },
    ...(limit ? { take: limit } : {}),
  });

  const rows: PostRow[] = published.map((pp) => ({
    postPlatformId: pp.id,
    postId: pp.post.id,
    title: pp.post.title,
    topic: pp.post.topic,
    pillar: pp.post.contentPillar,
    content: pp.content,
    platform: pp.platform,
    accountName: pp.accountName,
    publishedAt: pp.publishedAt!,
    externalUrl: pp.externalUrl,
    metrics: pp.metric ? (Object.fromEntries(METRIC_KEYS.map((k) => [k, pp.metric![k]])) as Metrics) : null,
    fetchedAt: pp.metric?.fetchedAt ?? null,
  }));

  const accounts = await prisma.socialAccount.findMany({
    where: { userId, isMock: isMockMode() },
    include: { accountMetrics: { where: { date: { gte: since } }, orderBy: { date: "asc" } } },
    orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
  });

  return {
    days,
    since,
    rows,
    measured: rows.filter((r) => r.metrics).length,
    totals: totalsOf(rows),
    byPillar: byPillar(rows),
    byWeekday: byWeekday(rows),
    byTimeBand: byTimeBand(rows),
    byPlatform: byPlatform(rows),
    accounts: accounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      name: accountDisplayName(a),
      status: a.status,
      metricsError: a.metricsError,
      metricsCheckedAt: a.metricsCheckedAt,
      ...followerChange(a.accountMetrics),
    })),
  };
}

export type AnalyticsData = Awaited<ReturnType<typeof getAnalytics>>;
