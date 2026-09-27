import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { recheckAccount } from "@/lib/social/account-service";

// 保存済みのキーが今も使えるかをSNSに問い合わせて確認する
export const POST = withErrorHandling(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  return NextResponse.json({ account: await recheckAccount(userId, (await params).id) });
});
