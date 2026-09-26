import type { LogStatus, PostLogEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { redact } from "@/lib/logging/logger";

type Db = Prisma.TransactionClient | typeof prisma;

// 投稿ログを記録する。metadata の秘密情報はマスクしてから保存する
export async function writePostLog(
  input: {
    postPlatformIds: string[];
    event: PostLogEvent;
    status: LogStatus;
    message: string;
    metadata?: Record<string, unknown>;
  },
  db: Db = prisma,
): Promise<void> {
  if (input.postPlatformIds.length === 0) return;
  const metadata = input.metadata ? (redact(input.metadata) as Prisma.InputJsonValue) : undefined;
  await db.postLog.createMany({
    data: input.postPlatformIds.map((postPlatformId) => ({
      postPlatformId,
      event: input.event,
      status: input.status,
      message: input.message,
      metadata,
    })),
  });
}
