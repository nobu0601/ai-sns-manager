// 開発用のサンプルデータ投入（npm run db:seed）。本番環境では実行しない
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { LOUNGE_PLUS_SAMPLE } from "./sample-data";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SAMPLE_SEED !== "true") {
    throw new Error("本番環境ではサンプルデータを投入しません（ALLOW_SAMPLE_SEED=true で強制可能）");
  }
  const email = process.env.SEED_USER_EMAIL ?? "demo@example.com";
  const password = process.env.SEED_USER_PASSWORD ?? "demo-password";

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "デモユーザー", passwordHash: await bcrypt.hash(password, 12) },
  });

  const existing = await prisma.brand.findFirst({ where: { userId: user.id, name: LOUNGE_PLUS_SAMPLE.name, isSample: true } });
  if (!existing) await prisma.brand.create({ data: { userId: user.id, ...LOUNGE_PLUS_SAMPLE } });

  console.info(`サンプルデータを投入しました: ${email} / ブランド「${LOUNGE_PLUS_SAMPLE.name}」`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
