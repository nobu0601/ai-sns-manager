import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { deletePost, getPost, updatePost } from "@/lib/posts/post-service";
import { postInputSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  return NextResponse.json({ post: await getPost(userId, (await params).id) });
});

export const PATCH = withErrorHandling(async (request: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const input = postInputSchema.parse(await readJson(request));
  return NextResponse.json({ post: await updatePost(userId, (await params).id, input) });
});

export const DELETE = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  await deletePost(userId, (await params).id);
  return new NextResponse(null, { status: 204 });
});
