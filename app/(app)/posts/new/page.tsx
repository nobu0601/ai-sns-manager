import { PageHeader } from "@/components/common/Card";
import { PostForm } from "@/components/posts/PostForm";
import { requirePageUserId } from "@/lib/auth/session";
import { loadPostFormOptions } from "@/lib/posts/form-data";

export const dynamic = "force-dynamic";

export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ topic?: string; brandId?: string; generate?: string }> }) {
  const userId = await requirePageUserId();
  const options = await loadPostFormOptions(userId);
  const { topic, brandId, generate } = await searchParams;
  return (
    <>
      <PageHeader title="投稿を作る" description="内容を書いて、投稿先と日時を選ぶだけで予約できます" />
      <PostForm {...options} defaults={{ topic: topic?.slice(0, 200), brandId, autoGenerate: generate === "1" }} />
    </>
  );
}
