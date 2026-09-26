import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // API は各 Route で 401 を返すため対象外。静的ファイルも除外
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
