import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requestMetricsRefresh } from "@/lib/analytics/metrics-service";
import { requireUserId } from "@/lib/auth/session";

// POST /api/analytics/refresh 自分のアカウントの数値を今すぐ取り直す（処理は Worker）
export const POST = withErrorHandling(async () => {
  const userId = await requireUserId();
  await requestMetricsRefresh(userId);
  return NextResponse.json({ ok: true }, { status: 202 });
});
