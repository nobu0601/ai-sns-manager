import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/api/base-url";
import { auth } from "@/auth";
import { isMockMode } from "@/lib/social/registry";
import { tiktokClientConfig } from "@/lib/social/tiktok/tiktok-api";
import { TIKTOK_STATE_COOKIE, authorizeUrl, connectMockTikTok, newState, tiktokRedirectUri } from "@/lib/social/tiktok/tiktok-connect";

// GET /api/social/tiktok/authorize 「TikTokでログインして連携」。TikTok の許可画面へ移動する
export async function GET(request: Request) {
  const base = appBaseUrl(request);
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${base}/login`);

  if (isMockMode()) {
    const result = await connectMockTikTok(session.user.id);
    return NextResponse.redirect(`${base}/accounts?tiktok=${result.ok ? "connected" : "failed"}`);
  }
  const config = tiktokClientConfig();
  if (!config) return NextResponse.redirect(`${base}/accounts?tiktok=not_configured`);

  const state = newState();
  const res = NextResponse.redirect(authorizeUrl(config.clientKey, tiktokRedirectUri(base), state));
  res.cookies.set(TIKTOK_STATE_COOKIE, state, { httpOnly: true, secure: base.startsWith("https://"), sameSite: "lax", path: "/api/social/tiktok", maxAge: 600 });
  return res;
}
