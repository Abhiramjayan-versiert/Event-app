import Link from "next/link";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext, requireAccess } from "@/lib/auth/session";
import { can, canInDepartment, departmentIdsWith } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { getEventPeople } from "@/features/departments/queries";
import { TaskBoard, TaskCalendar, TaskDialog, TaskList, type TaskRow } from "@/features/tasks/tasks-ui";
import { TASK_MODULES } from "@/lib/validations/task";
import { cn, titleCase } from "@/lib/utils";

export const metadata = { title: "Tasks" };
const VIEWS = ["list", "board", "calendar"] as const;
const SCOPES = [{ key: "mine", label: "My tasks" }, { key: "department", label: "Department tasks" }, { key: "all", label: "All event tasks" }] as const;

export default async function TasksPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { eventId } = await params;
  const sp = await searchParams;
  const access = await requireAccess();
  const { permissions } = await getEventContext(eventId);
  const view = VIEWS.find((v) => v === sp.view) ?? "list";
  const scope = SCOPES.find((s) => s.key === sp.scope)?.key ?? "all";
  const moduleFilter = TASK_MODULES.find((m) => m === sp.module);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : format(new Date(), "yyyy-MM");

  const supabase = await createClient();
  let query = supabase
    .from("tasks")
    .select("id, title, status, priority, module, task_type, due_at, progress_pct, department_id, created_by, department:departments(name), assignments:task_assignments(user_id, unassigned_at, user:profiles!task_assignments_user_id_fkey(full_name)), subtasks:tasks!parent_task_id(id)")
    .eq("event_id", eventId)
    .is("parent_task_id", null)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (moduleFilter) query = query.eq("module", moduleFilter);
  const [{ data }, people, depts] = await Promise.all([
    query,
    getEventPeople(eventId),
    supabase.from("departments").select("id, name").eq("event_id", eventId).eq("status", "active").order("sort_order"),
  ]);

  const myDepts = new Set(departmentIdsWith(permissions, "department.view"));
  const now = Date.now();
  const all: (TaskRow & { mine: boolean; deptId: string | null; createdBy: string | null; assigneeIds: string[] })[] = (data ?? []).map((t) => {
    const active = (t.assignments ?? []).filter((a) => !a.unassigned_at);
    return {
      id: t.id, title: t.title, status: t.status, priority: t.priority, module: t.module, task_type: t.task_type,
      department: t.department?.name ?? null, due_at: t.due_at, progress_pct: t.progress_pct,
      assignees: active.map((a) => a.user?.full_name ?? "—"), assigneeIds: active.map((a) => a.user_id),
      overdue: t.status !== "completed" && !!t.due_at && new Date(t.due_at).getTime() < now, subtasks: t.subtasks?.length ?? 0,
      mine: active.some((a) => a.user_id === access.user_id) || t.created_by === access.user_id,
      deptId: t.department_id, createdBy: t.created_by,
    };
  });
  const rows = scope === "mine" ? all.filter((t) => t.mine) : scope === "department" ? all.filter((t) => t.deptId && myDepts.has(t.deptId)) : all;
  const manageAll = can(permissions, "tasks.manage_all");
  const updatable = rows.filter((t) => manageAll || t.assigneeIds.includes(access.user_id) || (t.deptId && canInDepartment(permissions, t.deptId, "tasks.manage"))).map((t) => t.id);
  const creatableDepts = (depts.data ?? []).filter((d) => manageAll || canInDepartment(permissions, d.id, "tasks.manage"));
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ view, scope, module: moduleFilter, month, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/events/${eventId}/tasks?${q.toString()}`;
  };
  const [yy, mm] = month.split("-").map(Number);
  const prev = format(new Date(yy, mm - 2, 1), "yyyy-MM");
  const next = format(new Date(yy, mm, 1), "yyyy-MM");

  return (
    <div className="space-y-6">
      <RealtimeRefresh eventId={eventId} tables={["tasks"]} />
      <PageHeader
        title={moduleFilter ? `${titleCase(moduleFilter)} tasks` : "Tasks"}
        description="Assign work, track progress and deadlines across departments."
        actions={
          creatableDepts.length || manageAll ? (
            <TaskDialog
              eventId={eventId}
              departments={creatableDepts.map((d) => ({ id: d.id, name: d.name }))}
              people={people.map((p) => ({ id: p.id, name: p.name || p.email }))}
              defaults={moduleFilter ? { module: moduleFilter } : undefined}
              trigger={<Button><Plus /> New task</Button>}
            />
          ) : null
        }
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open" value={rows.filter((t) => t.status !== "completed").length} />
        <StatCard label="Completed" value={rows.filter((t) => t.status === "completed").length} />
        <StatCard label="Overdue" value={rows.filter((t) => t.overdue).length} highlight={rows.some((t) => t.overdue)} />
        <StatCard label="Assigned to me" value={all.filter((t) => t.assigneeIds.includes(access.user_id) && t.status !== "completed").length} />
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-1 rounded-md bg-muted p-1">
          {SCOPES.map((s) => <Link key={s.key} href={href({ scope: s.key })} className={cn("rounded-sm px-3 py-1.5 text-sm font-medium", scope === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{s.label}</Link>)}
        </nav>
        <nav className="flex gap-1 rounded-md bg-muted p-1">
          {VIEWS.map((v) => <Link key={v} href={href({ view: v })} className={cn("rounded-sm px-3 py-1.5 text-sm font-medium", view === v ? "bg-ink text-lime" : "text-muted-foreground hover:text-foreground")}>{titleCase(v)}</Link>)}
        </nav>
      </div>
      <div className="flex flex-wrap gap-1">
        <Link href={href({ module: undefined })} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", !moduleFilter ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>All workspaces</Link>
        {TASK_MODULES.map((m) => <Link key={m} href={href({ module: m })} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", moduleFilter === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{titleCase(m)}</Link>)}
      </div>

      {view === "list" ? <TaskList eventId={eventId} rows={rows} /> : null}
      {view === "board" ? <TaskBoard eventId={eventId} rows={rows} updatable={updatable} /> : null}
      {view === "calendar" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" asChild><Link href={href({ month: prev })} aria-label="Previous month"><ChevronLeft /></Link></Button>
            <span className="min-w-36 text-center text-sm font-semibold">{format(new Date(yy, mm - 1, 1), "MMMM yyyy")}</span>
            <Button variant="outline" size="icon-sm" asChild><Link href={href({ month: next })} aria-label="Next month"><ChevronRight /></Link></Button>
          </div>
          <TaskCalendar eventId={eventId} rows={rows} month={month} />
        </div>
      ) : null}
    </div>
  );
}
