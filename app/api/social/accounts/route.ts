import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { listAccounts } from "@/lib/social/account-service";
import { isMockMode } from "@/lib/social/registry";

export const GET = withErrorHandling(async () => {
  const userId = await requireUserId();
  return NextResponse.json({ accounts: await listAccounts(userId), mode: isMockMode() ? "mock" : "live" });
});
