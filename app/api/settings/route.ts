import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { settingsInputSchema } from "@/lib/validation/schemas";

export const GET = withErrorHandling(async () => {
  const userId = await requireUserId();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { approvalMode: true } });
  return NextResponse.json({ settings: user });
});

export const PATCH = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const input = settingsInputSchema.parse(await readJson(request));
  const user = await prisma.user.update({ where: { id: userId }, data: input, select: { approvalMode: true } });
  return NextResponse.json({ settings: user });
});
