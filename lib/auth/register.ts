import bcrypt from "bcryptjs";
import { prisma } from "@/lib/database/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { logger } from "@/lib/logging/logger";

export async function registerUser(input: { email: string; password: string; name?: string }) {
  const exists = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (exists) throw new ServiceError(409, "このメールアドレスは既に登録されています", "EMAIL_TAKEN");
  const user = await prisma.user.create({
    data: { email: input.email, name: input.name || null, passwordHash: await bcrypt.hash(input.password, 12) },
    select: { id: true, email: true },
  });
  logger.info("auth.register", { userId: user.id });
  return user;
}
