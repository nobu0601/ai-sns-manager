import { prisma } from "@/lib/database/prisma";
import { jstWeekRange } from "@/lib/datetime";
import { listAccounts } from "@/lib/social/account-service";

// ダッシュボードの数値（日本時間の今週＝月曜〜日曜）
export async function getDashboardStats(userId: string, now: Date = new Date()) {
  const week = jstWeekRange(now);

  const [accounts, weekPosts, weekPublished, scheduledCount, draftCount] = await Promise.all([
    listAccounts(userId),
    // 今週の投稿：今週に予約した投稿と、今週に投稿した投稿
    prisma.post.count({
      where: {
        userId,
        status: { not: "CANCELLED" },
        OR: [
          { scheduledAt: { gte: week.start, lt: week.end } },
          { platforms: { some: { publishedAt: { gte: week.start, lt: week.end } } } },
        ],
      },
    }),
    // 成功：今週に投稿できた件数（SNSアカウントごと）
    prisma.postPlatform.count({
      where: { post: { userId }, status: "PUBLISHED", publishedAt: { gte: week.start, lt: week.end } },
    }),
    prisma.post.count({ where: { userId, status: "SCHEDULED" } }),
    prisma.post.count({ where: { userId, status: { in: ["DRAFT", "READY"] } } }),
  ]);

  return { accounts, weekPosts, weekPublished, scheduledCount, draftCount };
}

export async function getCalendarPosts(userId: string, range: { start: Date; end: Date }) {
  return prisma.post.findMany({
    where: { userId, scheduledAt: { gte: range.start, lt: range.end } },
    include: { platforms: { select: { platform: true, status: true, accountName: true } } },
    orderBy: { scheduledAt: "asc" },
  });
}
