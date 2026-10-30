import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { AuditTable, type AuditRow } from "@/features/settings/audit-table";

export const metadata = { title: "Audit log" };

const IGNORED = new Set(["updated_at", "created_at"]);

function changedFields(oldData: unknown, newData: unknown) {
  const o = (oldData ?? {}) as Record<string, unknown>;
  const n = (newData ?? {}) as Record<string, unknown>;
  if (!oldData) return "created";
  if (!newData) return "deleted";
  return Object.keys(n).filter((k) => !IGNORED.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])).join(", ") || "—";
}

export default async function AuditPage() {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, occurred_at, actor_id, actor_role, action, entity_type, entity_id, event_id, old_data, new_data")
    .order("occurred_at", { ascending: false })
    .limit(1000);
  if (error) return <ErrorState title="Could not load the audit log" message={error.message} />;

  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter((x): x is string => !!x))];
  const eventIds = [...new Set((data ?? []).map((r) => r.event_id).filter((x): x is string => !!x))];
  const [actors, events] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : Promise.resolve({ data: [] }),
    eventIds.length ? supabase.from("events").select("id, name").in("id", eventIds) : Promise.resolve({ data: [] }),
  ]);
  const actorName = new Map((actors.data ?? []).map((a) => [a.id, a.full_name || a.email]));
  const eventName = new Map((events.data ?? []).map((e) => [e.id, e.name]));

  const rows: AuditRow[] = (data ?? []).map((r) => ({
    id: r.id,
    occurred_at: r.occurred_at,
    actor: r.actor_id ? actorName.get(r.actor_id) ?? r.actor_id : r.actor_role === "service_role" ? "System (API)" : "System",
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    event: r.event_id ? eventName.get(r.event_id) ?? "—" : "—",
    changes: changedFields(r.old_data, r.new_data),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" description="Append-only record of every change across the platform (latest 1,000 entries)." />
      <AuditTable rows={rows} />
    </div>
  );
}
