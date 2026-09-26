import { Alert } from "@/components/common/Alert";
import { PageHeader } from "@/components/common/Card";
import { AccountActions } from "@/components/social/AccountActions";
import { requirePageUserId } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { ACCOUNT_STATUS_LABELS } from "@/lib/labels";
import { listAccounts } from "@/lib/social/account-service";
import { PLATFORMS, isMockMode, parsePlatform } from "@/lib/social/registry";

export const dynamic = "force-dynamic";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const userId = await requirePageUserId();
  const { connected, error } = await searchParams;
  const accounts = await listAccounts(userId);
  const mock = isMockMode();
  const connectedPlatform = connected ? parsePlatform(connected) : null;

  return (
    <>
      <PageHeader title="SNSアカウント" description="投稿先のSNSアカウントを接続します。SNSのパスワードはこのアプリに保存されません。" />
      <div className="mb-4 space-y-3">
        {mock && (
          <Alert tone="warning" title="Mockモードで動作中です">
            実際のSNSには接続・投稿しません。接続ボタンを押すと、テスト用のアカウントが登録されます。
          </Alert>
        )}
        {connectedPlatform && <Alert tone="success" title={`${PLATFORM_LABELS[connectedPlatform]}を接続しました`} />}
        {error && <Alert title={error} />}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">SNS</th>
              <th className="px-4 py-3 font-medium">アカウント名</th>
              <th className="px-4 py-3 font-medium">接続状態</th>
              <th className="px-4 py-3 font-medium">最終接続確認</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {PLATFORMS.flatMap((platform) => {
              const rows = accounts.filter((a) => a.platform === platform);
              if (rows.length === 0) {
                return [
                  <tr key={platform}>
                    <td className="px-4 py-3 font-medium">{PLATFORM_LABELS[platform]}</td>
                    <td className="px-4 py-3 text-slate-400">-</td>
                    <td className="px-4 py-3 text-slate-500">○ 未接続</td>
                    <td className="px-4 py-3 text-slate-400">-</td>
                    <td className="px-4 py-3"><AccountActions platform={platform} needsReauth={false} /></td>
                  </tr>,
                ];
              }
              return rows.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-medium">{PLATFORM_LABELS[platform]}</td>
                  <td className="px-4 py-3">
                    {a.accountName}
                    {a.isMock && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">Mock</span>}
                  </td>
                  <td className={`px-4 py-3 ${a.status === "CONNECTED" ? "text-emerald-700" : "text-rose-700"}`}>
                    {a.status === "CONNECTED" ? "● " : "○ "}
                    {ACCOUNT_STATUS_LABELS[a.status]}
                    {a.isMock !== mock && <span className="block text-xs text-slate-500">現在のモードでは使用できません</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(a.lastCheckedAt)}</td>
                  <td className="px-4 py-3">
                    <AccountActions platform={platform} accountId={a.id} needsReauth={a.status !== "CONNECTED"} />
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
