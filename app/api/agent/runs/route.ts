import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { listAgentRuns } from "@/lib/agent/agent-service";
import { requireUserId } from "@/lib/auth/session";

// GET /api/agent/runs?brandId=…（省略時はすべてのブランド）
export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const brandId = new URL(request.url).searchParams.get("brandId") ?? undefined;
  return NextResponse.json({ runs: await listAgentRuns(userId, brandId) });
});
