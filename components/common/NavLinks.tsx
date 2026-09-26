"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "ダッシュボード" },
  { href: "/posts/new", label: "投稿を作る" },
  { href: "/posts", label: "投稿一覧・履歴" },
  { href: "/calendar", label: "カレンダー" },
  { href: "/accounts", label: "SNSアカウント" },
  { href: "/settings", label: "設定" },
];

export function NavLinks() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/posts" ? pathname === "/posts" || (/^\/posts\/(?!new)/.test(pathname)) : pathname.startsWith(href);

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
            isActive(l.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
