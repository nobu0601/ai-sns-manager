import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { createPost, listPosts } from "@/lib/posts/post-service";
import { postInputSchema } from "@/lib/validation/schemas";

export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  return NextResponse.json({ posts: await listPosts(userId, { status }) });
});

export const POST = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const input = postInputSchema.parse(await readJson(request));
  return NextResponse.json({ post: await createPost(userId, input) }, { status: 201 });
});
