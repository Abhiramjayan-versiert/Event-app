import { AppShell } from "@/components/layout/app-shell";
import { requireAccess } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  return <AppShell access={access}>{children}</AppShell>;
}
