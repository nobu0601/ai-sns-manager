import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { registerUser } from "@/lib/auth/register";
import { registerInputSchema } from "@/lib/validation/schemas";

export const POST = withErrorHandling(async (request: Request) => {
  const input = registerInputSchema.parse(await readJson(request));
  const user = await registerUser(input);
  return NextResponse.json({ user }, { status: 201 });
});
