import bcrypt from "bcryptjs";
import { prisma } from "@/lib/database/prisma";
import { ServiceError } from "@/lib/errors/service-error";
import { logger } from "@/lib/logging/logger";

// 新規登録できるメールアドレス（カンマ区切り）。未設定なら誰でも登録できる。
// 公開URLで動かすときは必ず設定する（他人に AI・画像生成の APIキーを使われないようにするため）
export function isRegistrationAllowed(email: string, allowed = process.env.ALLOWED_EMAILS): boolean {
  const list = (allowed ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length === 0 || list.includes(email.trim().toLowerCase());
}

export async function registerUser(input: { email: string; password: string; name?: string }) {
  if (!isRegistrationAllowed(input.email)) {
    logger.warn("auth.register_rejected");
    throw new ServiceError(403, "このメールアドレスでは登録できません。管理者に連絡してください。", "REGISTRATION_NOT_ALLOWED");
  }
  const exists = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (exists) throw new ServiceError(409, "このメールアドレスは既に登録されています", "EMAIL_TAKEN");
  const user = await prisma.user.create({
    data: { email: input.email, name: input.name || null, passwordHash: await bcrypt.hash(input.password, 12) },
    select: { id: true, email: true },
  });
  logger.info("auth.register", { userId: user.id });
  return user;
}
