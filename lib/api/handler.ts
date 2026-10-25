import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AIError, type AIErrorKind } from "@/lib/ai/errors";
import { ServiceError } from "@/lib/errors/service-error";

const AI_ERROR_STATUS: Record<AIErrorKind, number> = {
  NOT_CONFIGURED: 503,
  AUTH: 502,
  RATE_LIMIT: 429,
  REFUSAL: 422,
  INVALID_OUTPUT: 502,
  UNAVAILABLE: 503,
};
import { logger } from "@/lib/logging/logger";

export type ApiErrorBody = { error: { code: string; message: string; details?: string[] } };

// API Route の共通エラーハンドリング。内部エラーの詳細はログにだけ残す
export function withErrorHandling<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof ServiceError) {
    return NextResponse.json<ApiErrorBody>(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof AIError) {
    logger.warn("ai.error", { kind: err.kind, detail: err.detail });
    return NextResponse.json<ApiErrorBody>(
      { error: { code: `AI_${err.kind}`, message: err.message } },
      { status: AI_ERROR_STATUS[err.kind] },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json<ApiErrorBody>(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "入力内容を確認してください",
          details: err.issues.map((i) => i.message),
        },
      },
      { status: 400 },
    );
  }
  logger.error("api.unhandled_error", { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  return NextResponse.json<ApiErrorBody>(
    { error: { code: "INTERNAL_ERROR", message: "エラーが発生しました。時間をおいて再度お試しください。" } },
    { status: 500 },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ServiceError(400, "リクエストの形式が正しくありません", "BAD_REQUEST");
  }
}
