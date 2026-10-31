import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { ActivityTable, AuditTable, type ActivityRow, type AuditRow } from "@/features/settings/audit-table";
import { cn } from "@/lib/utils";

export const metadata = { title: "Activity & audit" };

const IGNORED = new Set(["updated_at", "created_at"]);
const LIMIT = 2000;

function changedFields(oldData: unknown, newData: unknown) {
  const o = (oldData ?? {}) as Record<string, unknown>;
  const n = (newData ?? {}) as Record<string, unknown>;
  if (!oldData) return "created";
  if (!newData) return "deleted";
  return Object.keys(n).filter((k) => !IGNORED.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])).join(", ") || "—";
}

/** Super Admin only: everything that happened across every college and event. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const access = await requireSuperAdmin();
  const tab = (await searchParams).tab === "changes" ? "changes" : "activity";
  const supabase = await createClient();

  const [activity, audit] = await Promise.all([
    tab === "activity"
      ? supabase.from("activity_log").select("id, created_at, actor_id, activity_type, summary, college_id, event_id, department_id").order("created_at", { ascending: false }).limit(LIMIT)
      : Promise.resolve(null),
    tab === "changes"
      ? supabase.from("audit_logs").select("id, occurred_at, actor_id, actor_role, action, entity_type, entity_id, event_id, old_data, new_data").order("occurred_at", { ascending: false }).limit(LIMIT)
      : Promise.resolve(null),
  ]);
  const error = activity?.error ?? audit?.error;
  if (error) return <ErrorState title="Could not load the log" message={error.message} />;

  const actRows = activity?.data ?? [];
  const audRows = audit?.data ?? [];
  const ids = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const actorIds = ids([...actRows.map((r) => r.actor_id), ...audRows.map((r) => r.actor_id)]);
  const eventIds = ids([...actRows.map((r) => r.event_id), ...audRows.map((r) => r.event_id)]);
  const collegeIds = ids(actRows.map((r) => r.college_id));
  const deptIds = ids(actRows.map((r) => r.department_id));
  const none = Promise.resolve({ data: [] as { id: string; name: string }[] });
  const [actors, events, colleges, depts] = await Promise.all([
    actorIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
    eventIds.length ? supabase.from("events").select("id, name").in("id", eventIds) : none,
    collegeIds.length ? supabase.from("colleges").select("id, name").in("id", collegeIds) : none,
    deptIds.length ? supabase.from("departments").select("id, name").in("id", deptIds) : none,
  ]);
  const actorName = new Map((actors.data ?? []).map((a) => [a.id, a.id === access.user_id ? "You" : a.full_name || a.email]));
  const name = (list: { id: string; name: string }[] | null) => new Map((list ?? []).map((x) => [x.id, x.name]));
  const eventName = name(events.data);
  const collegeName = name(colleges.data);
  const deptName = name(depts.data);
  const actor = (id: string | null, role?: string | null) =>
    id ? actorName.get(id) ?? "Removed user" : role === "service_role" ? "System (API)" : "System";

  const tabs = [
    { key: "activity", label: "Activity", hint: "Readable feed of what people did in every college and event." },
    { key: "changes", label: "Data changes", hint: "Append-only record of every row inserted, updated or deleted." },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Activity & audit" description={`Everything that happened across the platform (latest ${LIMIT.toLocaleString("en-IN")} entries). Only you can see this page.`} />
      <nav className="flex gap-1 border-b" aria-label="Log type">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/audit?tab=${t.key}`}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">{tabs.find((t) => t.key === tab)?.hint}</p>
      {tab === "activity" ? (
        <ActivityTable
          rows={actRows.map((r): ActivityRow => ({
            id: r.id, created_at: r.created_at, actor: actor(r.actor_id), activity_type: r.activity_type, summary: r.summary,
            college: r.college_id ? collegeName.get(r.college_id) ?? "—" : "—",
            event: r.event_id ? eventName.get(r.event_id) ?? "—" : "—",
            department: r.department_id ? deptName.get(r.department_id) ?? "—" : "—",
          }))}
        />
      ) : (
        <AuditTable
          rows={audRows.map((r): AuditRow => ({
            id: r.id, occurred_at: r.occurred_at, actor: actor(r.actor_id, r.actor_role), action: r.action, entity_type: r.entity_type,
            entity_id: r.entity_id, event: r.event_id ? eventName.get(r.event_id) ?? "—" : "—", changes: changedFields(r.old_data, r.new_data),
          }))}
        />
      )}
    </div>
  );
}
