import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/common/AppShell";
import { isMockMode } from "@/lib/social/registry";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <AppShell userName={session.user.name || session.user.email || ""} mockMode={isMockMode()}>
      {children}
    </AppShell>
  );
}
