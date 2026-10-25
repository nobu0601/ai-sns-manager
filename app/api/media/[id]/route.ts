import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { getMedia } from "@/lib/media/media-service";

export const GET = withErrorHandling(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  return NextResponse.json({ media: await getMedia(userId, (await params).id) });
});
