import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { approveAgentRun } from "@/lib/agent/agent-service";
import { requireUserId } from "@/lib/auth/session";

// 計画された投稿をまとめて承認し、計画した日時で予約する
export const POST = withErrorHandling(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  return NextResponse.json({ results: await approveAgentRun(userId, (await params).id) });
});
