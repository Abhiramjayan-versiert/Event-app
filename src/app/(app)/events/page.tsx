import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { EventsTable, type EventRow } from "@/features/events/events-table";
import { collegesForEventCreation } from "@/features/events/queries";

export const metadata = { title: "Events" };

export default async function EventsPage() {
  const access = await requireAccess();
  const supabase = await createClient();
  const [{ data, error }, creatable] = await Promise.all([
    supabase.from("events").select("id, name, category, status, starts_on, ends_on, venue, college:colleges(name)").order("starts_on", { ascending: false }),
    collegesForEventCreation(access),
  ]);
  if (error) return <ErrorState title="Could not load events" message={error.message} />;
  const rows: EventRow[] = (data ?? []).map(({ college, ...e }) => ({ ...e, college: college?.name ?? "—" }));
  const canCreate = creatable.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description="Every event you can access. Each event has its own isolated workspace."
        actions={canCreate ? <Button asChild><Link href="/events/new"><Plus /> New event</Link></Button> : null}
      />
      <EventsTable rows={rows} canCreate={canCreate} />
    </div>
  );
}
