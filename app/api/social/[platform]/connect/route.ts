import { NextResponse } from "next/server";
import { oauthRedirectUri } from "@/lib/api/base-url";
import { withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { notFound } from "@/lib/errors/service-error";
import { startConnect } from "@/lib/social/account-service";
import { parsePlatform } from "@/lib/social/registry";

// OAuth 認可URLを返す。画面側はこのURLへ遷移する（接続・再認証共通）
export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ platform: string }> }) => {
  const userId = await requireUserId();
  const platform = parsePlatform((await params).platform);
  if (!platform) throw notFound("SNS");
  const url = await startConnect(userId, platform, oauthRedirectUri(request, platform));
  return NextResponse.json({ authorizationUrl: url });
});
