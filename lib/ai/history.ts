import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { isMockMode } from "@/lib/social/registry";

// AI に渡す「これまでの投稿」。このアプリで投稿・予約したものと、SNS から読み込んだ過去の投稿をまとめる
export interface HistoryPost {
  date: Date;
  platform: Platform;
  text: string;
  source: "app" | "sns";
}

export const HISTORY_LIMIT = 30;

const normalize = (text: string) => text.replace(/\s+/g, "").slice(0, 80);

// 新しい順に最大 limit 件。同じ文章（複数アカウントに同じ内容を投稿した場合など）は1件にまとめる
export async function loadPostHistory(
  userId: string,
  brandId: string | null | undefined,
  { limit = HISTORY_LIMIT }: { limit?: number } = {},
): Promise<HistoryPost[]> {
  const [own, external] = await Promise.all([
    prisma.postPlatform.findMany({
      where: {
        status: { in: ["PUBLISHED", "SCHEDULED", "POSTING"] },
        post: { userId, ...(brandId ? { brandId } : {}) },
      },
      select: { platform: true, content: true, publishedAt: true, post: { select: { scheduledAt: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
      take: limit * 3,
    }),
    prisma.externalPost.findMany({
      where: {
        socialAccount: { userId, isMock: isMockMode(), ...(brandId ? { OR: [{ brandId }, { brandId: null }] } : {}) },
      },
      select: { platform: true, text: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
      take: limit * 3,
    }),
  ]);

  const items: HistoryPost[] = [
    ...own.map((p) => ({
      date: p.publishedAt ?? p.post.scheduledAt ?? p.post.createdAt,
      platform: p.platform,
      text: p.content,
      source: "app" as const,
    })),
    ...external.map((p) => ({ date: p.publishedAt, platform: p.platform, text: p.text, source: "sns" as const })),
  ].filter((p) => p.text.trim());

  items.sort((a, b) => b.date.getTime() - a.date.getTime());
  const seen = new Set<string>();
  const result: HistoryPost[] = [];
  for (const item of items) {
    const key = normalize(item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}
