import { redirect } from "next/navigation";
import { Alert } from "@/components/common/Alert";
import { PageHeader } from "@/components/common/Card";
import { PostForm } from "@/components/posts/PostForm";
import { requirePageUserId } from "@/lib/auth/session";
import { loadPostFormOptions } from "@/lib/posts/form-data";
import { getPost } from "@/lib/posts/post-service";
import { isEditable } from "@/lib/posts/status";

export const dynamic = "force-dynamic";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePageUserId();
  const { id } = await params;
  const post = await getPost(userId, id).catch(() => null);
  if (!post) redirect("/posts");
  if (!isEditable(post.status) || post.platforms.some((p) => p.status === "PUBLISHED")) redirect(`/posts/${id}`);
  const options = await loadPostFormOptions(userId);

  return (
    <>
      <PageHeader title="投稿を編集" />
      {post.status === "SCHEDULED" && (
        <div className="mb-4">
          <Alert tone="info">編集して保存すると予約はいったん解除されます。内容を確認してから、もう一度予約してください。</Alert>
        </div>
      )}
      <PostForm
        {...options}
        initial={{
          id: post.id,
          title: post.title,
          topic: post.topic,
          brandId: post.brandId,
          scheduledAt: post.scheduledAt?.toISOString() ?? null,
          targets: post.platforms.map((p) => ({
            socialAccountId: p.socialAccountId,
            platform: p.platform,
            accountName: p.accountName,
            content: p.content,
            mediaUrls: p.mediaUrls,
          })),
        }}
      />
    </>
  );
}
