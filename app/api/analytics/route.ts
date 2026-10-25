import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { ANALYTICS_PERIODS, getAnalytics } from "@/lib/analytics/analytics-service";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { notFound } from "@/lib/errors/service-error";

// GET /api/analytics?brandId=…&days=7|30|90 投稿の数値・集計・フォロワー数
export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const params = new URL(request.url).searchParams;
  const brandId = params.get("brandId");
  if (brandId && !(await prisma.brand.findFirst({ where: { id: brandId, userId } }))) throw notFound("ブランド");
  const requested = Number(params.get("days"));
  const days = (ANALYTICS_PERIODS as readonly number[]).includes(requested) ? requested : 30;
  return NextResponse.json(await getAnalytics(userId, { brandId, days }));
});
