import { PrismaClient } from "@prisma/client";

// 開発時のホットリロードで接続が増え続けないよう、グローバルに1つだけ保持する
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
