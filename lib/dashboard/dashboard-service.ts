import { prisma } from "@/lib/database/prisma";
import { jstDayRange, jstMonthRange, jstParts } from "@/lib/datetime";
import { listAccounts } from "@/lib/social/account-service";

export async function getDashboardStats(userId: string, now: Date = new Date()) {
  const today = jstDayRange(now);
  const { year, month } = jstParts(now);
  const monthRange = jstMonthRange(year, month);

  const [accounts, todayCount, scheduledCount, monthPublished, monthFailed, draftCount] = await Promise.all([
    listAccounts(userId),
    prisma.post.count({ where: { userId, scheduledAt: { gte: today.start, lt: today.end } } }),
    prisma.post.count({ where: { userId, status: "SCHEDULED" } }),
    prisma.postPlatform.count({
      where: { post: { userId }, status: "PUBLISHED", publishedAt: { gte: monthRange.start, lt: monthRange.end } },
    }),
    prisma.postPlatform.count({
      where: { post: { userId }, status: "FAILED", updatedAt: { gte: monthRange.start, lt: monthRange.end } },
    }),
    prisma.post.count({ where: { userId, status: { in: ["DRAFT", "READY"] } } }),
  ]);

  const attempted = monthPublished + monthFailed;
  return {
    accounts,
    todayCount,
    scheduledCount,
    monthPublished,
    draftCount,
    // 今月の成功率（投稿を試みた件数が0なら null）
    successRate: attempted === 0 ? null : Math.round((monthPublished / attempted) * 100),
  };
}

export async function getCalendarPosts(userId: string, range: { start: Date; end: Date }) {
  return prisma.post.findMany({
    where: { userId, scheduledAt: { gte: range.start, lt: range.end } },
    include: { platforms: { select: { platform: true, status: true, accountName: true } } },
    orderBy: { scheduledAt: "asc" },
  });
}
