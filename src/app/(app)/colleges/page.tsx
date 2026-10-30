import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireAccess } from "@/lib/auth/session";
import { canSeeGlobalDashboard } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { CollegesTable, type CollegeRow } from "@/features/colleges/colleges-table";

export const metadata = { title: "Colleges" };

export default async function CollegesPage() {
  const access = await requireAccess();
  if (!canSeeGlobalDashboard(access)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("colleges")
    .select("id, name, code, city, state, status, email, created_at, events(count)")
    .order("name");
  if (error) return <ErrorState title="Could not load colleges" message={error.message} />;

  const rows: CollegeRow[] = (data ?? []).map(({ events, ...c }) => ({ ...c, events: events?.[0]?.count ?? 0 }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colleges"
        description="Every institution on the platform. Archived colleges stay available for reporting and audit."
        actions={access.is_super_admin ? <Button asChild><Link href="/colleges/new"><Plus /> New college</Link></Button> : null}
      />
      <CollegesTable rows={rows} canCreate={access.is_super_admin} />
    </div>
  );
}
