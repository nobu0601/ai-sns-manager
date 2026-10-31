// 利用規約・プライバシーポリシー（ログインしなくても読める。TikTok などの連携アプリ登録で URL を求められる）
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-sm leading-7 text-slate-800 [&_h1]:mb-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
      {children}
    </main>
  );
}
