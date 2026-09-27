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

  const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  return (
    <>
      <PageHeader title="設定" description="投稿モードとブランド情報（AI生成の設定）を管理します" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card title="投稿モード">
            <ApprovalModeForm current={user.approvalMode} />
          </Card>
          <Card title="AI（Claude）">
            <p className="text-sm">
              APIキー：
              {aiConfigured ? (
                <span className="font-semibold text-emerald-700">● 設定済み</span>
              ) : (
                <span className="font-semibold text-slate-500">○ 未設定</span>
              )}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              AIによる投稿文の生成（Phase 2）に使います。サーバーの .env の ANTHROPIC_API_KEY に設定してください。キーは画面には表示しません。
            </p>
          </Card>
        </div>
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
