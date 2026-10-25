import { NextResponse } from "next/server";
import { generateDrafts } from "@/lib/ai/ai-service";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { getPost } from "@/lib/posts/post-service";
import { draftRequestSchema } from "@/lib/validation/schemas";

// 既存の投稿のテーマ・ブランドで投稿案を作る（投稿自体は変更しない）
export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const post = await getPost(userId, (await params).id);
  const input = draftRequestSchema.partial().parse(await readJson(request).catch(() => ({})));
  return NextResponse.json(
    await generateDrafts(userId, {
      topic: input.topic ?? post.topic ?? post.title,
      objective: input.objective,
      brandId: input.brandId ?? post.brandId,
      styles: input.styles,
    }),
  );
});
