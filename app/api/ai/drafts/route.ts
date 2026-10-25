import { NextResponse } from "next/server";
import { generateDrafts } from "@/lib/ai/ai-service";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { draftRequestSchema } from "@/lib/validation/schemas";

// テーマとブランドから投稿案を作る（既定は5つの型）。結果は保存せず返すだけ。採用した案は通常の投稿として保存する
export const POST = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const input = draftRequestSchema.parse(await readJson(request));
  return NextResponse.json(await generateDrafts(userId, input));
});
