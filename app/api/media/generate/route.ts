import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";

// 画像・動画生成は Phase 3 で実装する
export const POST = withErrorHandling(async () => {
  await requireUserId();
  return NextResponse.json(
    { error: { code: "NOT_IMPLEMENTED", message: "画像・動画生成は Phase 3 で対応予定です" } },
    { status: 501 },
  );
});
