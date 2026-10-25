import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { startAgentRun } from "@/lib/agent/agent-service";
import { requireUserId } from "@/lib/auth/session";

// AI Agent に今後7日間の投稿を作らせる（処理は Worker。状態は GET /api/agent/runs で確認）
export const POST = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const { brandId } = z.object({ brandId: z.string().min(1) }).parse(await readJson(request));
  return NextResponse.json({ run: await startAgentRun(userId, brandId) }, { status: 202 });
});
