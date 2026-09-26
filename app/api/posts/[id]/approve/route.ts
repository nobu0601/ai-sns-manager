import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { approvePost } from "@/lib/posts/post-service";

export const POST = withErrorHandling(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  return NextResponse.json({ post: await approvePost(userId, (await params).id) });
});
