import type { Platform } from "@prisma/client";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { SETUP_GUIDES, type ScreenMock } from "@/lib/social/setup-guides";

// 押す場所を示す簡単な画面のイメージ図（実際の画面の見た目とは異なる）
function ScreenSketch({ screen }: { screen: ScreenMock }) {
  const phone = screen.kind === "phone";
  return (
    <figure className={`mt-2 ${phone ? "max-w-[240px]" : "max-w-xl"}`} aria-label="画面のイメージ図">
      <div className={`overflow-hidden border border-slate-300 bg-white shadow-sm ${phone ? "rounded-3xl" : "rounded-lg"}`}>
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-1.5">
          {!phone && (
            <span className="flex gap-1" aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-rose-300" />
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
            </span>
          )}
          <span className="truncate rounded bg-white px-2 py-0.5 text-[11px] text-slate-500">{screen.site}</span>
        </div>
        <div className="flex text-xs">
          {screen.sidebar && (
            <ul className="w-44 shrink-0 space-y-0.5 border-r border-slate-200 bg-slate-50 p-2">
              {screen.sidebar.map((s, i) => (
                <li
                  key={i}
                  className={`break-words rounded px-1.5 py-1 ${s.active ? "bg-sky-100 font-semibold text-sky-800" : "text-slate-500"}`}
                >
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          <div className="min-w-0 flex-1 space-y-1.5 p-3">
            {screen.heading && <p className="mb-2 font-semibold text-slate-800">{screen.heading}</p>}
            {screen.rows.map((r, i) => (
              <div
                key={i}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 ${r.highlight ? "bg-amber-50 ring-2 ring-amber-400" : "bg-slate-50"}`}
              >
                <span className="min-w-0 truncate text-slate-700">{r.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {r.note && <span className="text-[10px] font-semibold text-amber-700">{r.note}</span>}
                  {r.action && (
                    <span className={`rounded px-2 py-0.5 font-semibold ${r.highlight ? "bg-sky-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300"}`}>
                      {r.action}
                    </span>
                  )}
                  {r.highlight && r.action && <span className="text-[10px] font-bold text-amber-700">← ここを押す</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-1 text-[11px] text-slate-400">画面のイメージ図です（実際の画面とは見た目が異なります）</figcaption>
    </figure>
  );
}

// 「キーの取得方法」。各 SNS のアカウント一覧の上に、開いて読める形で表示する
export function SetupGuide({ platform, open = false }: { platform: Platform; open?: boolean }) {
  const guide = SETUP_GUIDES[platform];
  const name = PLATFORM_LABELS[platform];
  return (
    <details className="mb-4 rounded-lg border border-sky-200 bg-sky-50/60 p-3" open={open}>
      <summary className="cursor-pointer text-sm font-semibold text-sky-900">
        はじめての方へ：{name}のキーの取得方法（画面つき）
      </summary>
      <div className="mt-3 space-y-4 text-sm text-slate-700">
        <p>{guide.summary}</p>
        <div>
          <p className="font-semibold text-slate-900">始める前に用意するもの</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {guide.before.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
        <ol className="space-y-5">
          {guide.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{step.title}</p>
                {step.body.map((line, j) => (
                  <p key={j} className="mt-1">
                    {line}
                  </p>
                ))}
                {step.images?.length ? (
                  <div className="mt-2 space-y-3">
                    {step.images.map((img) => (
                      <figure key={img.src} className="max-w-3xl">
                        <a href={img.src} target="_blank" rel="noreferrer" title="クリックで大きく表示">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.src} alt={img.alt} loading="lazy" className="w-full rounded-lg border border-slate-300 shadow-sm" />
                        </a>
                        <figcaption className="mt-1 text-xs text-slate-500">{img.alt}</figcaption>
                      </figure>
                    ))}
                    <p className="text-[11px] text-slate-400">実際の画面です（2026年10月時点。個人情報はぼかしています）。画像を押すと大きく表示されます</p>
                  </div>
                ) : (
                  step.screen && <ScreenSketch screen={step.screen} />
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="rounded-md bg-white p-3 ring-1 ring-slate-200">
          <p className="font-semibold text-slate-900">連携したあとの注意</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {guide.after.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">
          キーやトークンはパスワードと同じです。他の人やチャットに送らず、この画面に直接入れてください。
          SNS 側の画面の名前は変わることがあります。参考：
          {guide.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer" className="ml-1 underline">
              {s.label}
            </a>
          ))}
        </p>
      </div>
    </details>
  );
}
