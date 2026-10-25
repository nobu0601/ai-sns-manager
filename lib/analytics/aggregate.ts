import type { Platform } from "@prisma/client";
import { jstHour, jstParts } from "@/lib/datetime";

// 分析の集計（DB を使わない純粋な計算）。画面の表と、AI に渡す根拠データの両方に使う

export const METRIC_KEYS = ["views", "reach", "likes", "comments", "shares", "saves", "clicks"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Record<MetricKey, number | null>;

export const METRIC_LABELS: Record<MetricKey, string> = {
  views: "表示",
  reach: "リーチ",
  likes: "いいね",
  comments: "コメント",
  shares: "シェア",
  saves: "保存",
  clicks: "クリック",
};

export interface PostRow {
  postPlatformId: string;
  postId: string;
  title: string;
  topic: string;
  pillar: string | null;
  content: string;
  platform: Platform;
  accountName: string;
  publishedAt: Date;
  externalUrl: string | null;
  metrics: Metrics | null;
  fetchedAt: Date | null;
}

// 反応 = いいね + コメント + シェア + 保存（取得できた項目だけを足す。1つも無ければ null）
export function reactionsOf(m: Metrics | null): number | null {
  if (!m) return null;
  const parts = [m.likes, m.comments, m.shares, m.saves].filter((v): v is number => v !== null);
  return parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0);
}

// 反応率（%）= 反応 ÷ 表示。表示が取れない・0 のときは null
export function engagementRateOf(m: Metrics | null): number | null {
  const reactions = reactionsOf(m);
  if (!m || reactions === null || !m.views) return null;
  return Math.round((reactions / m.views) * 1000) / 10;
}

// 合計。取得できた投稿が1件も無い指標は null（画面では「-」）
export function totalsOf(rows: PostRow[]): Metrics {
  const out = {} as Metrics;
  for (const key of METRIC_KEYS) {
    const values = rows.map((r) => r.metrics?.[key]).filter((v): v is number => typeof v === "number");
    out[key] = values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  }
  return out;
}

const avg = (values: (number | null)[]): number | null => {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length === 0 ? null : Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
};

export interface GroupStat {
  key: string;
  posts: number;
  avgViews: number | null;
  avgReactions: number | null;
  avgEngagementRate: number | null;
}

function groupBy(rows: PostRow[], keyOf: (r: PostRow) => string, order?: string[]): GroupStat[] {
  const groups = new Map<string, PostRow[]>();
  for (const r of rows) {
    if (!r.metrics) continue;
    const key = keyOf(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const stats = [...groups.entries()].map(([key, list]) => ({
    key,
    posts: list.length,
    avgViews: avg(list.map((r) => r.metrics!.views)),
    avgReactions: avg(list.map((r) => reactionsOf(r.metrics))),
    avgEngagementRate: avg(list.map((r) => engagementRateOf(r.metrics))),
  }));
  if (order) return stats.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return stats.sort((a, b) => (b.avgReactions ?? -1) - (a.avgReactions ?? -1));
}

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
// 時間帯（日本時間）
export const TIME_BANDS = [
  { key: "朝（6〜11時）", from: 6, to: 11 },
  { key: "昼（11〜14時）", from: 11, to: 14 },
  { key: "午後（14〜18時）", from: 14, to: 18 },
  { key: "夜（18〜22時）", from: 18, to: 22 },
  { key: "深夜（22〜6時）", from: 22, to: 30 },
];

export function timeBandOf(date: Date): string {
  const h = jstHour(date);
  const hour = h < 6 ? h + 24 : h;
  return TIME_BANDS.find((b) => hour >= b.from && hour < b.to)!.key;
}

export const byPillar = (rows: PostRow[]) => groupBy(rows, (r) => r.pillar ?? "（柱なし）");
export const byWeekday = (rows: PostRow[]) =>
  groupBy(rows, (r) => `${WEEKDAY_LABELS[jstParts(r.publishedAt).weekday]}曜日`, WEEKDAY_LABELS.map((w) => `${w}曜日`));
export const byTimeBand = (rows: PostRow[]) => groupBy(rows, (r) => timeBandOf(r.publishedAt), TIME_BANDS.map((b) => b.key));
export const byPlatform = (rows: PostRow[]) => groupBy(rows, (r) => r.platform);

// フォロワーの増減（期間内の最初と最後の記録の差）。記録が2件未満なら null
export function followerChange(points: { date: Date; followers: number }[]): { latest: number | null; change: number | null } {
  if (points.length === 0) return { latest: null, change: null };
  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = sorted[sorted.length - 1].followers;
  return { latest, change: sorted.length < 2 ? null : latest - sorted[0].followers };
}
