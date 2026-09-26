import Link from "next/link";
import { signOut } from "@/auth";
import { NavLinks } from "./NavLinks";

export function AppShell({ userName, mockMode, children }: { userName: string; mockMode: boolean; children: React.ReactNode }) {
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <Link href="/dashboard" className="text-lg font-bold text-brand-700">
            AI SNS Manager
          </Link>
          {mockMode && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 md:mt-2 md:inline-block">
              Mockモード
            </span>
          )}
        </div>
        <NavLinks />
        <div className="hidden border-t border-slate-100 px-5 py-4 text-sm md:absolute md:bottom-0 md:block md:w-full">
          <p className="truncate text-slate-600">{userName}</p>
          <form action={logout}>
            <button className="mt-2 text-sm font-medium text-slate-500 hover:text-slate-800">ログアウト</button>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      <form action={logout} className="px-4 pb-6 md:hidden">
        <button className="text-sm font-medium text-slate-500">ログアウト（{userName}）</button>
      </form>
    </div>
  );
}
