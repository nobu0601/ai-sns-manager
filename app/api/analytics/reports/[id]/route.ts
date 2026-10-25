import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { getAnalysisReport } from "@/lib/analytics/analysis-service";
import { requireUserId } from "@/lib/auth/session";

export const GET = withErrorHandling(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const { id } = await params;
  return NextResponse.json({ report: await getAnalysisReport(userId, id) });
});
