import { Card, PageHeader } from "@/components/common/Card";
import { ApprovalModeForm } from "@/components/settings/ApprovalModeForm";
import { BrandForm } from "@/components/settings/BrandForm";
import { BrandList } from "@/components/settings/BrandList";
import { DEFAULT_MODEL } from "@/lib/ai/claude-provider";
import { aiMode } from "@/lib/ai/registry";
import { mediaMode } from "@/lib/media/registry";
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
  const mode = aiMode();
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  return (
    <>
      <PageHeader title="設定" description="投稿モードとブランド情報（AI生成の設定）を管理します" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card title="投稿モード">
            <ApprovalModeForm current={user.approvalMode} />
          </Card>
          <Card title="AI（Claude）">
            <dl className="space-y-1 text-sm">
              <div>
                <dt className="inline text-slate-500">APIキー：</dt>
                <dd className="inline">
                  {aiConfigured ? (
                    <span className="font-semibold text-emerald-700">● 設定済み</span>
                  ) : (
                    <span className="font-semibold text-slate-500">○ 未設定</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="inline text-slate-500">動作：</dt>
                <dd className="inline">{mode === "claude" ? `Claude（${model}）` : "Mock（AIを呼ばず例文を返す）"}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              投稿作成画面の「AIで投稿案を作る」で使います。キーはサーバーの .env の ANTHROPIC_API_KEY に設定してください（画面には表示しません）。
              ブランドの説明・トーン・禁止キーワードなどが、AIへの指示に使われます。
            </p>
          </Card>
          <Card title="画像・動画生成（fal.ai）">
            <dl className="space-y-1 text-sm">
              <div>
                <dt className="inline text-slate-500">APIキー：</dt>
                <dd className="inline">
                  {process.env.FAL_KEY?.trim() ? (
                    <span className="font-semibold text-emerald-700">● 設定済み</span>
                  ) : (
                    <span className="font-semibold text-slate-500">○ 未設定</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="inline text-slate-500">動作：</dt>
                <dd className="inline">{mediaMode() === "fal" ? "fal.ai で生成" : "Mock（仮の画像を返す）"}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              投稿作成画面の「AIで画像を作る」「AIで動画を作る」と、AIエージェントの画像生成で使います。キーはサーバーの .env の FAL_KEY に設定してください。
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
