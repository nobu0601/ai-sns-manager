import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ServiceError } from "@/lib/errors/service-error";

// API Route 用：未ログインなら 401
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new ServiceError(401, "ログインしてください", "UNAUTHORIZED");
  return session.user.id;
}

// ページ用：未ログインならログイン画面へ
export async function requirePageUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}
