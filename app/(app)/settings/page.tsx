import { Card, PageHeader } from "@/components/common/Card";
import { ApprovalModeForm } from "@/components/settings/ApprovalModeForm";
import { BrandForm } from "@/components/settings/BrandForm";
import { BrandList } from "@/components/settings/BrandList";
import { requirePageUserId } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/brand-service";
import { prisma } from "@/lib/database/prisma";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const userId = await requirePageUserId();
  const [user, brands] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { approvalMode: true } }),
    listBrands(userId),
  ]);

  return (
    <>
      <PageHeader title="設定" description="投稿モードとブランド情報（AI生成の設定）を管理します" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="投稿モード">
          <ApprovalModeForm current={user.approvalMode} />
        </Card>
        <div className="space-y-6">
          <Card title="ブランド">
            <BrandList brands={brands} />
          </Card>
          <Card title="ブランドを追加">
            <BrandForm />
          </Card>
        </div>
      </div>
    </>
  );
}
