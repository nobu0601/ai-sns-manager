import { NextResponse } from "next/server";
import { appBaseUrl, oauthRedirectUri } from "@/lib/api/base-url";
import { auth } from "@/auth";
import { ServiceError } from "@/lib/errors/service-error";
import { userMessageFor } from "@/lib/errors/user-messages";
import { logger } from "@/lib/logging/logger";
import { completeConnect } from "@/lib/social/account-service";
import { SocialPublishError } from "@/lib/social/errors";
import { parsePlatform } from "@/lib/social/registry";

// SNSの認可画面から戻ってくる先。結果はアカウント画面にクエリで伝える
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const base = appBaseUrl(request);
  const back = (query: Record<string, string>) =>
    NextResponse.redirect(`${base}/accounts?${new URLSearchParams(query).toString()}`);

  const platform = parsePlatform((await params).platform);
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${base}/login`);
  if (!platform) return back({ error: "不明なSNSです" });

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) {
    logger.warn("social.connect.denied", { platform, error: url.searchParams.get("error") });
    return back({ error: "接続がキャンセルされました" });
  }

  try {
    await completeConnect({
      userId: session.user.id,
      platform,
      state,
      code,
      redirectUri: oauthRedirectUri(request, platform),
    });
    return back({ connected: platform });
  } catch (err) {
    logger.error("social.connect.failed", { platform, error: err instanceof Error ? err.message : String(err) });
    if (err instanceof ServiceError) return back({ error: err.message });
    if (err instanceof SocialPublishError) return back({ error: userMessageFor(err.kind, platform) });
    return back({ error: "接続に失敗しました。もう一度お試しください。" });
  }
}
