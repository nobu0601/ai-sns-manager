import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI SNS Manager",
  description: "X / Instagram / Threads の投稿を一元管理",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
