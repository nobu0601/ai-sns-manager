import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { getCalendarPosts } from "@/lib/dashboard/dashboard-service";
import { jstMonthRange, jstParts, parseYearMonth } from "@/lib/datetime";
import { ServiceError } from "@/lib/errors/service-error";

// GET /api/calendar?month=YYYY-MM（省略時は今月）
export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const monthParam = new URL(request.url).searchParams.get("month");
  const ym = monthParam ? parseYearMonth(monthParam) : jstParts(new Date());
  if (!ym) throw new ServiceError(400, "month は YYYY-MM 形式で指定してください", "BAD_REQUEST");
  const posts = await getCalendarPosts(userId, jstMonthRange(ym.year, ym.month));
  return NextResponse.json({ year: ym.year, month: ym.month, posts });
});
