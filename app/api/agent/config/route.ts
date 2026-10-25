import { NextResponse } from "next/server";
import { readJson, withErrorHandling } from "@/lib/api/handler";
import { getAgentConfig, saveAgentConfig } from "@/lib/agent/agent-service";
import { requireUserId } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors/service-error";
import { agentConfigSchema } from "@/lib/validation/schemas";

function brandIdOf(request: Request): string {
  const brandId = new URL(request.url).searchParams.get("brandId");
  if (!brandId) throw new ServiceError(400, "brandId を指定してください", "BAD_REQUEST");
  return brandId;
}

// GET /api/agent/config?brandId=… / PUT /api/agent/config?brandId=…
export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  return NextResponse.json({ config: await getAgentConfig(userId, brandIdOf(request)) });
});

export const PUT = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId();
  const input = agentConfigSchema.parse(await readJson(request));
  return NextResponse.json({ config: await saveAgentConfig(userId, brandIdOf(request), input) });
});
