import Link from "next/link";
import { Alert } from "@/components/common/Alert";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { Badge } from "@/components/common/Badge";
import { Card, PageHeader } from "@/components/common/Card";
import { AnalyzeButton, RefreshMetricsButton } from "@/components/analytics/AnalyticsActions";
import { AnalysisEvidenceTable, GroupTable, MetricValue, PostMetricsTable } from "@/components/analytics/AnalyticsTables";
import { reactionsOf, type GroupStat } from "@/lib/analytics/aggregate";
import { ANALYSIS_MIN_POSTS, listAnalysisReports, type AnalysisEvidence } from "@/lib/analytics/analysis-service";
import { ANALYTICS_PERIODS, getAnalytics } from "@/lib/analytics/analytics-service";
import { aiMode } from "@/lib/ai/registry";
import type { AnalysisOutput } from "@/lib/ai/types";
import { requirePageUserId } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/brand-service";
import { formatDateTime } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { isMockMode } from "@/lib/social/registry";

export const dynamic = "force-dynamic";

const REPORT_STATUS = {
  QUEUED: { label: "待機中", tone: "gray" },
  RUNNING: { label: "分析中", tone: "amber" },
  COMPLETED: { label: "完了", tone: "green" },
  FAILED: { label: "失敗", tone: "red" },
} as const;

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">
        <MetricValue value={value} />
      </p>
    </div>
  );
}

function Evidence({ refs }: { refs: string[] }) {
  return <span className="ml-1 text-xs text-slate-500">（根拠：{refs.join("・")}）</span>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ brandId?: string; days?: string }> }) {
  const userId = await requirePageUserId();
  const brands = await listBrands(userId);
  if (brands.length === 0) {
    return (
      <>
        <PageHeader title="分析" />
        <Alert tone="info" title="先にブランドを登録してください">
          分析はブランドごとに行います。<Link href="/settings" className="ml-1 font-semibold underline">設定画面</Link>からブランドを追加してください。
        </Alert>
      </>
    );
  }

  const { brandId: requestedBrand, days: requestedDays } = await searchParams;
  const brand = brands.find((b) => b.id === requestedBrand) ?? brands[0];
  const days = (ANALYTICS_PERIODS as readonly number[]).includes(Number(requestedDays)) ? Number(requestedDays) : 30;
  const [data, reports] = await Promise.all([getAnalytics(userId, { brandId: brand.id, days }), listAnalysisReports(userId, brand.id, 3)]);
  const latest = reports[0];
  const busy = reports.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  const shown = reports.find((r) => r.status === "COMPLETED");
  const result = shown?.result as AnalysisOutput | null | undefined;
  const evidence = shown?.evidence as AnalysisEvidence | null | undefined;
  const href = (q: { brandId?: string; days?: number }) => `/analytics?brandId=${q.brandId ?? brand.id}&days=${q.days ?? days}`;

  return (
    <>
      <AutoRefresh active={busy} />
      <PageHeader
        title="分析"
        description="SNSから取得した投稿の数値と、AIによる分析（参考情報）を確認できます"
        action={<RefreshMetricsButton />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {brands.length > 1 &&
          brands.map((b) => (
            <Link
              key={b.id}
              href={href({ brandId: b.id })}
              className={`rounded-full px-3 py-1 text-sm font-medium ${b.id === brand.id ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
            >
              {b.name}
            </Link>
          ))}
        <span className="ml-auto flex gap-1">
          {ANALYTICS_PERIODS.map((d) => (
            <Link
              key={d}
              href={href({ days: d })}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${d === days ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
            >
              {d}日間
            </Link>
          ))}
        </span>
      </div>

      <div className="mb-4 space-y-2">
        {isMockMode() && <Alert tone="warning" title="SNSはMockモードです。表示される数値は架空の値です。" />}
        {aiMode() === "mock" && <Alert tone="warning" title="AIはMockモードです（ANTHROPIC_API_KEY 未設定）。決まった形の分析を表示します。" />}
      </div>

      <Card title="アカウント" className="mb-6">
        {data.accounts.length === 0 ? (
          <p className="text-sm text-slate-600">
            アカウントが連携されていません。<Link href="/accounts" className="font-semibold text-brand-600">SNSアカウント画面</Link>から連携してください。
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.accounts.map((a) => (
              <li key={a.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {PLATFORM_LABELS[a.platform]} {a.name}
                  </span>
                  <span className="text-slate-700">
                    フォロワー <MetricValue value={a.latest} />
                    {a.change !== null && (
                      <span className={`ml-2 text-xs font-semibold ${a.change >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {a.change >= 0 ? "+" : ""}
                        {a.change.toLocaleString("ja-JP")}（{days}日間）
                      </span>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">最終取得：{formatDateTime(a.metricsCheckedAt)}</p>
                {a.metricsError && <p className="mt-1 text-xs text-rose-700">{a.metricsError}</p>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">投稿から30日以内の投稿の数値とフォロワー数を、6時間ごとに自動で取得します。</p>
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        {brand.name}・直近{days}日間（投稿 {data.rows.length}件、うち数値を取得できた投稿 {data.measured}件）
      </h2>
      <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="表示" value={data.totals.views} />
        <Stat label="リーチ" value={data.totals.reach} />
        <Stat label="いいね" value={data.totals.likes} />
        <Stat label="コメント" value={data.totals.comments} />
        <Stat label="シェア" value={data.totals.shares} />
        <Stat label="保存" value={data.totals.saves} />
      </div>
      <p className="mb-6 text-xs text-slate-500">「-」はSNSのAPIから取得できない項目です（例：リーチは Instagram のみ、保存は Threads では取得できません）。</p>

      <Card
        title="AIの分析（参考情報）"
        className="mb-6"
        action={latest && <Badge tone={REPORT_STATUS[latest.status].tone}>{REPORT_STATUS[latest.status].label}</Badge>}
      >
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <AnalyzeButton brandId={brand.id} disabled={busy} />
          <p className="flex-1 text-xs text-slate-500">
            直近の投稿（最大30件）の実績をAIが読み、反応が良かったテーマ・文章・時間帯の傾向と次回の投稿案をまとめます。
            AIの分析は参考情報です。下の根拠データ（実際の数値）と合わせて確認してください。
            AIエージェントの毎週の自動実行の前にも自動で分析し、計画に反映します。
          </p>
        </div>
        {busy && <p role="status" className="mb-3 text-sm text-slate-600">数値を取得して分析しています。1〜2分ほどかかります…</p>}
        {latest?.status === "FAILED" && <Alert title={latest.errorMessage ?? "分析に失敗しました"} />}
        {!shown && !busy && latest?.status !== "FAILED" && (
          <p className="text-sm text-slate-600">まだ分析していません。数値を取得できた投稿が{ANALYSIS_MIN_POSTS}件以上あると分析できます。</p>
        )}
        {shown && result && (
          <div className="space-y-5 text-sm">
            <p className="text-xs text-slate-500">
              {formatDateTime(shown.finishedAt)} の分析（{shown.trigger === "SCHEDULED" ? "毎週の自動実行" : "手動"}・{shown.postCount}件の投稿）
            </p>
            <p className="whitespace-pre-wrap text-slate-800">{result.summary}</p>

            <section>
              <h3 className="mb-1 font-semibold text-slate-900">反応が良かったテーマ</h3>
              <ul className="list-disc space-y-1 pl-5 text-slate-700">
                {result.goodThemes.length === 0 && <li>特になし</li>}
                {result.goodThemes.map((t, i) => (
                  <li key={i}>
                    <span className="font-medium">{t.theme}</span>：{t.reason}
                    <Evidence refs={t.evidence} />
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 font-semibold text-slate-900">文章の傾向</h3>
              <ul className="list-disc space-y-1 pl-5 text-slate-700">
                {result.textTrends.length === 0 && <li>特になし</li>}
                {result.textTrends.map((t, i) => (
                  <li key={i}>
                    {t.finding}
                    <Evidence refs={t.evidence} />
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 font-semibold text-slate-900">投稿時間の傾向</h3>
              <ul className="list-disc space-y-1 pl-5 text-slate-700">
                {result.timeTrends.length === 0 && <li>特になし</li>}
                {result.timeTrends.map((t, i) => (
                  <li key={i}>
                    {t.finding}
                    <Evidence refs={t.evidence} />
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 font-semibold text-slate-900">次回の投稿案</h3>
              <ul className="space-y-2">
                {result.nextIdeas.map((idea, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {idea.title} <Badge tone="violet">{idea.pillar}</Badge>
                      </p>
                      <p className="text-xs text-slate-600">{idea.topic}</p>
                      <p className="text-xs text-slate-500">{idea.reason}</p>
                    </div>
                    <Link
                      href={`/posts/new?brandId=${brand.id}&topic=${encodeURIComponent(idea.topic)}`}
                      className="shrink-0 text-sm font-semibold text-brand-600"
                    >
                      この案で投稿を作る
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            {evidence && (
              <details className="rounded-lg bg-slate-50 p-3" open>
                <summary className="cursor-pointer text-sm font-semibold text-slate-800">根拠データ（AIに渡した実績）</summary>
                <div className="mt-3">
                  <AnalysisEvidenceTable posts={evidence.posts} />
                </div>
              </details>
            )}
          </div>
        )}
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="投稿テーマの柱ごと（平均）">
          <GroupTable groups={data.byPillar} />
        </Card>
        <Card title="時間帯ごと（平均）">
          <GroupTable groups={data.byTimeBand} />
        </Card>
        <Card title="曜日ごと（平均）">
          <GroupTable groups={data.byWeekday} />
        </Card>
      </div>

      <Card title="SNSごと（平均）" className="mb-6">
        <GroupTable groups={data.byPlatform.map((g): GroupStat => ({ ...g, key: PLATFORM_LABELS[g.key as keyof typeof PLATFORM_LABELS] ?? g.key }))} />
        <p className="mt-2 text-xs text-slate-500">SNSごとに表示回数の数え方が違うため、SNSどうしの数値の比較は目安です。</p>
      </Card>

      <Card title="投稿ごとの数値">
        {data.rows.length === 0 ? (
          <p className="text-sm text-slate-600">この期間に投稿済みの投稿はありません。</p>
        ) : (
          <PostMetricsTable rows={data.rows.map((r) => ({ ...r, reactions: reactionsOf(r.metrics) }))} />
        )}
      </Card>
    </>
  );
}
