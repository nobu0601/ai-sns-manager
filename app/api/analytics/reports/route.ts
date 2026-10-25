import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { listAnalysisReports } from "@/lib/analytics/analysis-service";
import { requireUserId } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";

// GET /api/analytics/reports?brandId=… 分析結果（新しい順）
export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const brandId = new URL(request.url).searchParams.get("brandId");
  if (!brandId) throw new ServiceError(400, "ブランドを指定してください", "VALIDATION_ERROR");
  return NextResponse.json({ reports: await listAnalysisReports(userId, brandId) });
});
