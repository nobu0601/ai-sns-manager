import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { requireUserId } from "@/lib/auth/session";
import { createBrand, listBrands } from "@/lib/brands/brand-service";
import { brandInputSchema } from "@/lib/validation/schemas";

export const GET = withErrorHandling(async () => {
  const userId = await requireUserId();
  return NextResponse.json({ brands: await listBrands(userId) });
});

export const POST = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const input = brandInputSchema.parse(await readJson(request));
  return NextResponse.json({ brand: await createBrand(userId, input) }, { status: 201 });
});
