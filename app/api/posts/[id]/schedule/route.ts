import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { schedulePost } from "@/lib/posts/post-service";
import { scheduleInputSchema } from "@/lib/validation/schemas";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const input = scheduleInputSchema.parse(await readJson(request));
  return NextResponse.json({ post: await schedulePost(userId, (await params).id, input) });
});
