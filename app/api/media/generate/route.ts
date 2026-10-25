import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { requestMedia } from "@/lib/media/media-service";
import { mediaRequestSchema } from "@/lib/validation/schemas";

// 画像・動画の生成を受け付ける。生成は Worker が行うため、状態は GET /api/media/:id で確認する
export const POST = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const input = mediaRequestSchema.parse(await readJson(request));
  return NextResponse.json({ media: await requestMedia(userId, input) }, { status: 202 });
});
