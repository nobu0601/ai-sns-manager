import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { disconnectAccount } from "@/lib/social/account-service";

export const DELETE = withErrorHandling(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  await disconnectAccount(userId, (await params).id);
  return new NextResponse(null, { status: 204 });
});
