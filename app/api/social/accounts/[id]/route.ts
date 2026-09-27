import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { disconnectAccount, updateAccount } from "@/lib/social/account-service";
import { accountUpdateSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

// 表示名・ブランドの変更、キーの差し替え
export const PATCH = withErrorHandling(async (request: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const input = accountUpdateSchema.parse(await readJson(request));
  return NextResponse.json({ account: await updateAccount(userId, (await params).id, input) });
});

export const DELETE = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  await disconnectAccount(userId, (await params).id);
  return new NextResponse(null, { status: 204 });
});
