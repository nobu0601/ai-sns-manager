import { prisma } from "@/lib/database/prisma";
import { listBrands } from "@/lib/brands/brand-service";
import { listPostableAccounts } from "@/lib/social/account-service";

// 投稿フォームに必要な選択肢（ブランド・承認モード・投稿先に選べるアカウント）
export async function loadPostFormOptions(userId: string) {
  const [brands, user, accounts] = await Promise.all([
    listBrands(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { approvalMode: true } }),
    listPostableAccounts(userId),
  ]);
  return {
    brands: brands.map((b) => ({ id: b.id, name: b.isSample ? `${b.name}（サンプル）` : b.name })),
    approvalMode: user.approvalMode,
    accounts,
  };
}
