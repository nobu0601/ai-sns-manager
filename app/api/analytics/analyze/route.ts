import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { startAnalysis } from "@/lib/analytics/analysis-service";
import { requireUserId } from "@/lib/auth/session";

// POST /api/analytics/analyze {brandId} AI で分析する（処理は Worker。結果は GET /api/analytics/reports）
export const POST = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const { brandId } = z.object({ brandId: z.string().min(1) }).parse(await readJson(request));
  return NextResponse.json({ report: await startAnalysis(userId, brandId) }, { status: 202 });
});
