import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { listRecentMedia } from "@/lib/media/media-service";

// 最近生成した画像・動画（できあがったもの）
export const GET = withErrorHandling(async () => {
  const userId = await requireUserId();
  return NextResponse.json({ media: await listRecentMedia(userId) });
});
