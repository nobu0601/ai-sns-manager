import Link from "next/link";
import { engagementRateOf, type GroupStat, type PostRow } from "@/lib/analytics/aggregate";
import type { EvidencePost } from "@/lib/analytics/analysis-service";
import { formatDateTime } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";

// 取得できない値（null）は「-」で表示する（0 と区別する）
export function MetricValue({ value, suffix = "" }: { value: number | null | undefined; suffix?: string }) {
  if (value === null || value === undefined) return <span className="text-slate-400">-</span>;
  return (
    <>
      {value.toLocaleString("ja-JP")}
      {suffix}
    </>
  );
}

const th = "px-2 py-1.5 text-left text-xs font-semibold text-slate-600 whitespace-nowrap";
const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

export function GroupTable({ groups }: { groups: GroupStat[] }) {
  if (groups.length === 0) return <p className="text-sm text-slate-500">数値を取得できた投稿がありません</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className={th}>区分</th>
            <th className={`${th} text-right`}>投稿</th>
            <th className={`${th} text-right`}>表示</th>
            <th className={`${th} text-right`}>反応</th>
            <th className={`${th} text-right`}>反応率</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-b border-slate-100">
              <td className="px-2 py-1.5 text-slate-800">{g.key}</td>
              <td className={td}>{g.posts}</td>
              <td className={td}><MetricValue value={g.avgViews} /></td>
              <td className={td}><MetricValue value={g.avgReactions} /></td>
              <td className={td}><MetricValue value={g.avgEngagementRate} suffix="%" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">反応 = いいね＋コメント＋シェア＋保存、反応率 = 反応 ÷ 表示</p>
    </div>
  );
}

export function PostMetricsTable({ rows }: { rows: (PostRow & { reactions: number | null })[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className={th}>投稿</th>
            <th className={th}>投稿日時</th>
            <th className={`${th} text-right`}>表示</th>
            <th className={`${th} text-right`}>いいね</th>
            <th className={`${th} text-right`}>コメント</th>
            <th className={`${th} text-right`}>シェア</th>
            <th className={`${th} text-right`}>保存</th>
            <th className={`${th} text-right`}>反応率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.postPlatformId} className="border-b border-slate-100 align-top">
              <td className="max-w-xs px-2 py-1.5">
                <Link href={`/posts/${r.postId}`} className="block truncate font-medium text-slate-900 hover:text-brand-600">
                  {r.title}
                </Link>
                <span className="text-xs text-slate-500">
                  {PLATFORM_LABELS[r.platform]} {r.accountName}
                  {r.pillar && `・${r.pillar}`}
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-600">{formatDateTime(r.publishedAt)}</td>
              {r.metrics ? (
                <>
                  <td className={td}><MetricValue value={r.metrics.views} /></td>
                  <td className={td}><MetricValue value={r.metrics.likes} /></td>
                  <td className={td}><MetricValue value={r.metrics.comments} /></td>
                  <td className={td}><MetricValue value={r.metrics.shares} /></td>
                  <td className={td}><MetricValue value={r.metrics.saves} /></td>
                  <td className={td}><MetricValue value={engagementRateOf(r.metrics)} suffix="%" /></td>
                </>
              ) : (
                <td colSpan={6} className="px-2 py-1.5 text-right text-xs text-slate-500">まだ数値を取得していません</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// AI に渡した実績（ref つき）。AI の結論の「根拠：P1」と対応する
export function AnalysisEvidenceTable({ posts }: { posts: EvidencePost[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className={th}>ref</th>
            <th className={th}>投稿</th>
            <th className={th}>日時</th>
            <th className={`${th} text-right`}>表示</th>
            <th className={`${th} text-right`}>反応</th>
            <th className={`${th} text-right`}>反応率</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.ref} className="border-b border-slate-100 align-top">
              <td className="px-2 py-1.5 font-mono text-xs text-slate-600">{p.ref}</td>
              <td className="max-w-xs px-2 py-1.5">
                <Link href={`/posts/${p.postId}`} className="block truncate font-medium text-slate-900 hover:text-brand-600">
                  {p.title}
                </Link>
                <span className="text-xs text-slate-500">
                  {p.platform} {p.accountName}
                  {p.pillar && `・${p.pillar}`}
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-600">{p.date}（{p.timeBand}）</td>
              <td className={td}><MetricValue value={p.views} /></td>
              <td className={td}><MetricValue value={p.reactions} /></td>
              <td className={td}><MetricValue value={p.engagementRate} suffix="%" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
