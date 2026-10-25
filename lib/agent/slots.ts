import { jstDate, jstParts } from "@/lib/datetime";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_MS = 24 * 60 * 60 * 1000;
// 計画を作ってから最初の投稿までに空ける時間（承認の余裕）
export const MIN_LEAD_MS = 60 * 60 * 1000;
export const PLAN_DAYS = 7;

export function parseTime(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hour = m ? Math.min(23, Number(m[1])) : 12;
  const minute = m ? Math.min(59, Number(m[2])) : 0;
  return { hour, minute };
}

export function slotLabel(date: Date): string {
  const p = jstParts(date);
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${p.month}/${p.day}(${WEEKDAY_LABELS[p.weekday]}) ${hh}:${mm}`;
}

const dayKey = (d: Date) => {
  const p = jstParts(d);
  return `${p.year}-${p.month}-${p.day}`;
};

// 今後7日間の投稿枠を決める。ユーザーが選んだ曜日・時刻を優先し、足りなければ他の曜日で補う。
// 既に投稿予定がある日は避ける。日時はコードで決め、AI はテーマだけを割り当てる
export function computeSlots(input: {
  now: Date;
  postsPerWeek: number;
  preferredWeekdays: number[];
  preferredTime: string;
  busyDates?: Date[];
}): Date[] {
  const { hour, minute } = parseTime(input.preferredTime);
  const busy = new Set((input.busyDates ?? []).map(dayKey));
  const today = jstParts(input.now);
  const earliest = input.now.getTime() + MIN_LEAD_MS;
  const latest = input.now.getTime() + PLAN_DAYS * DAY_MS;

  const candidates: Date[] = [];
  for (let offset = 0; offset <= PLAN_DAYS; offset++) {
    const base = jstDate(today.year, today.month, today.day + offset);
    const at = new Date(base.getTime() + (hour * 60 + minute) * 60 * 1000);
    if (at.getTime() < earliest || at.getTime() > latest || busy.has(dayKey(at))) continue;
    candidates.push(at);
  }

  const wanted = Math.max(0, Math.min(input.postsPerWeek, candidates.length));
  const preferred = candidates.filter((d) => input.preferredWeekdays.includes(jstParts(d).weekday));
  const others = candidates.filter((d) => !preferred.includes(d));
  const picked = pickSpread(preferred, Math.min(wanted, preferred.length));
  if (picked.length < wanted) picked.push(...pickSpread(others, wanted - picked.length));
  return picked.sort((a, b) => a.getTime() - b.getTime());
}

// 並んだ候補から、間隔ができるだけ均等になるように n 個選ぶ
function pickSpread<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (n >= items.length) return [...items];
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
}
