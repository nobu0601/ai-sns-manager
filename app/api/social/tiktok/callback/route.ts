import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/api/base-url";
import { auth } from "@/auth";
import { TIKTOK_STATE_COOKIE, connectTikTok, tiktokRedirectUri } from "@/lib/social/tiktok/tiktok-connect";

// GET /api/social/tiktok/callback TikTok の許可画面から戻る先（TikTok for Developers に登録する Redirect URI）
export async function GET(request: Request) {
  const base = appBaseUrl(request);
  const back = (status: string) => {
    const res = NextResponse.redirect(`${base}/accounts?tiktok=${status}`);
    res.cookies.delete({ name: TIKTOK_STATE_COOKIE, path: "/api/social/tiktok" });
    return res;
  };
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${base}/login`);

  const params = new URL(request.url).searchParams;
  const expected = (await cookies()).get(TIKTOK_STATE_COOKIE)?.value;
  // 他のサイトから仕掛けられた連携を防ぐため、出発時の state と一致するものだけ受け付ける
  if (!expected || params.get("state") !== expected) return back("failed");
  if (params.get("error") || !params.get("code")) return back("denied");

  const result = await connectTikTok(session.user.id, params.get("code")!, tiktokRedirectUri(base));
  return back(result.ok ? "connected" : result.reason);
}
