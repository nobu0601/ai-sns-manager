import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";

// AI投稿生成は Phase 2 で実装する
export const POST = withErrorHandling(async () => {
  await requireUserId();
  return NextResponse.json(
    { error: { code: "NOT_IMPLEMENTED", message: "AI投稿生成は Phase 2 で対応予定です" } },
    { status: 501 },
  );
});
