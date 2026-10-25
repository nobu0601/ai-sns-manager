import type { PostMetricValues } from "../types";

// SNS の数値（項目名は SNS のまま）から、アプリ共通の指標を作る。
// 対応する項目が1つも無い指標は null にする（「取得できない」と「0」を区別するため）
export function sumOf(raw: Record<string, number>, keys: string[]): number | null {
  const present = keys.filter((k) => typeof raw[k] === "number");
  return present.length === 0 ? null : present.reduce((n, k) => n + raw[k], 0);
}

export function toMetricValues(
  raw: Record<string, number>,
  map: Partial<Record<Exclude<keyof PostMetricValues, "raw">, string[]>>,
): PostMetricValues {
  const pick = (k: Exclude<keyof PostMetricValues, "raw">) => (map[k] ? sumOf(raw, map[k]!) : null);
  return {
    views: pick("views"),
    reach: pick("reach"),
    likes: pick("likes"),
    comments: pick("comments"),
    shares: pick("shares"),
    saves: pick("saves"),
    clicks: pick("clicks"),
    raw,
  };
}

// Meta（Threads / Instagram）の insights レスポンス {data:[{name, values:[{value}]}]} を {name: value} にする
export function readInsights(body: { data?: { name?: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } }[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of body.data ?? []) {
    const value = m.values?.[0]?.value ?? m.total_value?.value;
    if (m.name && typeof value === "number") out[m.name] = value;
  }
  return out;
}
