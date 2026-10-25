import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { getAgentRun } from "@/lib/agent/agent-service";
import { requireUserId } from "@/lib/auth/session";

export const GET = withErrorHandling(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  return NextResponse.json({ run: await getAgentRun(userId, (await params).id) });
});
