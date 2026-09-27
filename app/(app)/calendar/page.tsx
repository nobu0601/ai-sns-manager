import Link from "next/link";
import { PageHeader } from "@/components/common/Card";
import { requirePageUserId } from "@/lib/auth/session";
import { buildMonthGrid, formatYearMonth, shiftMonth } from "@/lib/calendar";
import { getCalendarPosts } from "@/lib/dashboard/dashboard-service";
import { APP_TIMEZONE, jstMonthRange, jstParts, parseYearMonth } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { POST_STATUS_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "border-indigo-200 bg-indigo-50 text-indigo-800",
  PUBLISHED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  FAILED: "border-rose-200 bg-rose-50 text-rose-800",
  POSTING: "border-amber-200 bg-amber-50 text-amber-900",
};

const timeFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit" });

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const userId = await requirePageUserId();
  const { month } = await searchParams;
  const today = jstParts(new Date());
  const ym = parseYearMonth(month) ?? { year: today.year, month: today.month };
  const posts = await getCalendarPosts(userId, jstMonthRange(ym.year, ym.month));

  const byDay = new Map<string, typeof posts>();
  for (const post of posts) {
    if (!post.scheduledAt) continue;
    const d = jstParts(post.scheduledAt);
    const key = `${d.year}-${d.month}-${d.day}`;
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }
  const prev = shiftMonth(ym.year, ym.month, -1);
  const next = shiftMonth(ym.year, ym.month, 1);
  const todayKey = `${today.year}-${today.month}-${today.day}`;

  return (
    <>
      <PageHeader title="カレンダー" description="予約・投稿済みの投稿を日付ごとに表示します（日本時間）" />
      <div className="mb-4 flex items-center gap-4">
        <Link href={`/calendar?month=${formatYearMonth(prev.year, prev.month)}`} className="rounded-md px-2 py-1 text-sm font-semibold text-brand-600 hover:bg-brand-50">
          ← 前の月
        </Link>
        <h2 className="text-lg font-bold">{ym.year}年{ym.month}月</h2>
        <Link href={`/calendar?month=${formatYearMonth(next.year, next.month)}`} className="rounded-md px-2 py-1 text-sm font-semibold text-brand-600 hover:bg-brand-50">
          次の月 →
        </Link>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-600">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`py-2 ${i === 5 ? "text-sky-700" : i === 6 ? "text-rose-700" : ""}`}>{w}</div>
            ))}
          </div>
          {buildMonthGrid(ym.year, ym.month).map((week) => (
            <div key={week[0].key} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
              {week.map((cell) => (
                <div key={cell.key} className={`min-h-28 border-r border-slate-100 p-1.5 last:border-r-0 ${cell.inMonth ? "" : "bg-slate-50/60"}`}>
                  <div className={`mb-1 text-xs ${cell.key === todayKey ? "inline-block rounded-full bg-brand-600 px-1.5 font-bold text-white" : cell.inMonth ? "text-slate-700" : "text-slate-400"}`}>
                    {cell.day}
                  </div>
                  <ul className="space-y-1">
                    {(byDay.get(cell.key) ?? []).map((post) => (
                      <li key={post.id}>
                        <Link
                          href={`/posts/${post.id}`}
                          title={`${post.title}（${POST_STATUS_LABELS[post.status]}）`}
                          className={`block truncate rounded border px-1.5 py-0.5 text-xs ${STATUS_COLORS[post.status] ?? "border-slate-200 bg-slate-50 text-slate-700"}`}
                        >
                          {post.scheduledAt && timeFormat.format(post.scheduledAt)} {post.title}
                          <span className="block truncate text-[10px] opacity-75">
                            {post.platforms.map((p) => `${PLATFORM_LABELS[p.platform]} ${p.accountName}`.trim()).join("・")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
