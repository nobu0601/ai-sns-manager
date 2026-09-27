import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { notFound } from "@/lib/errors/service-error";
import { connectAccount } from "@/lib/social/account-service";
import { parsePlatform } from "@/lib/social/registry";
import { accountCreateSchema } from "@/lib/validation/schemas";

// APIキーを入力してアカウントを連携する。キーはSNSに問い合わせて確認してから暗号化して保存する
export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ platform: string }> }) => {
  const userId = await requireUserId();
  const platform = parsePlatform((await params).platform);
  if (!platform) throw notFound("SNS");
  const input = accountCreateSchema.parse(await readJson(request));
  return NextResponse.json({ account: await connectAccount(userId, platform, input) }, { status: 201 });
});
