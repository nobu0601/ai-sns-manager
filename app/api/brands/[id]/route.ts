import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { deleteBrand, updateBrand } from "@/lib/brands/brand-service";
import { brandInputSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const input = brandInputSchema.parse(await readJson(request));
  return NextResponse.json({ brand: await updateBrand(userId, (await params).id, input) });
});

export const DELETE = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  await deleteBrand(userId, (await params).id);
  return new NextResponse(null, { status: 204 });
});
