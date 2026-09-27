import { Alert } from "@/components/common/Alert";
import { PageHeader } from "@/components/common/Card";
import { AccountList } from "@/components/social/AccountList";
import { requirePageUserId } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/brand-service";
import { listAccounts } from "@/lib/social/account-service";
import { MOCK_INVALID_KEY } from "@/lib/social/mock/mock-adapter";
import { PLATFORMS, isMockMode } from "@/lib/social/registry";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const userId = await requirePageUserId();
  const [accounts, brands] = await Promise.all([listAccounts(userId), listBrands(userId)]);
  const mock = isMockMode();

  return (
    <>
      <PageHeader
        title="SNSアカウント"
        description="投稿したいアカウントのAPIキーを登録すると連携できます。同じSNSで複数のアカウントを登録できます。SNSのログインパスワードは不要で、保存もしません。"
      />
      {mock && (
        <div className="mb-4">
          <Alert tone="warning" title="Mockモードで動作中です">
            実際のSNSには問い合わせ・投稿をしません。キーには任意の文字列を入力できます（「{MOCK_INVALID_KEY}」を含めると無効なキーとして扱います）。
            本番で使うときは .env の SOCIAL_PROVIDER_MODE を live にしてください。
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        {PLATFORMS.map((platform) => (
          <AccountList
            key={platform}
            platform={platform}
            accounts={accounts.filter((a) => a.platform === platform)}
            brands={brands.map((b) => ({ id: b.id, name: b.name }))}
            mockMode={mock}
          />
        ))}
      </div>
    </>
  );
}
