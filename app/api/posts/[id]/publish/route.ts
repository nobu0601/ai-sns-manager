import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { schedulePost } from "@/lib/posts/post-service";
import { publishInputSchema } from "@/lib/validation/schemas";

// 今すぐ投稿。Webリクエスト内では投稿せず、即時実行ジョブとしてキューに登録する
export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const input = publishInputSchema.parse(await readJson(request));
  return NextResponse.json({ post: await schedulePost(userId, (await params).id, { scheduledAt: new Date(), ...input }) });
});
