import Link from "next/link";
import { AlarmClock, CheckCircle2, Plus, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { UserAvatar } from "@/components/ui/avatar";
import { DepartmentIcon } from "@/features/departments/department-icon";
import { DepartmentFormDialog } from "@/features/departments/department-form-dialog";
import { publicStorageUrl } from "@/lib/storage";
import { cn, formatCurrency, titleCase } from "@/lib/utils";

export const metadata = { title: "Departments" };

type Overview = {
  id: string; name: string; kind: string; icon: string; status: string; description: string | null; progress_pct: number;
  head: { user_id: string; name: string; email: string; avatar_path: string | null } | null;
  members: number; tasks_total: number; tasks_completed: number; tasks_overdue: number;
  budget: { allocated: number; approved: number; paid: number } | null;
  can_open: boolean;
};

export default async function DepartmentsPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ show?: string }> }) {
  const { eventId } = await params;
  const { show } = await searchParams;
  const { event, permissions } = await getEventContext(eventId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_departments_overview", { p_event: eventId });
  if (error) return <ErrorState title="Could not load departments" message={error.message} />;

  const all = (data as unknown as Overview[]) ?? [];
  const archived = all.filter((d) => d.status === "archived").length;
  const departments = show === "archived" ? all.filter((d) => d.status === "archived") : all.filter((d) => d.status !== "archived");
  const canManage = can(permissions, "departments.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description={`${all.length - archived} active department${all.length - archived === 1 ? "" : "s"}. Each department has its own workspace, team and budget.`}
        actions={
          <>
            {archived > 0 ? (
              <Button variant="outline" asChild>
                <Link href={show === "archived" ? `/events/${eventId}/departments` : `/events/${eventId}/departments?show=archived`}>
                  {show === "archived" ? "Show active" : `Archived (${archived})`}
                </Link>
              </Button>
            ) : null}
            {canManage && event.status !== "archived" ? (
              <DepartmentFormDialog eventId={eventId} trigger={<Button><Plus /> New department</Button>} />
            ) : null}
          </>
        }
      />

      {departments.length === 0 ? (
        <EmptyState title="No departments" description="Create a department to organise the event team." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => {
            const taskPct = d.tasks_total ? (100 * d.tasks_completed) / d.tasks_total : 0;
            const budgetPct = d.budget && d.budget.allocated ? (100 * d.budget.approved) / d.budget.allocated : 0;
            const card = (
              <div className={cn("flex h-full flex-col gap-4 rounded-lg border bg-card p-5 transition-colors", d.can_open && "hover:border-primary")}>
                <div className="flex items-start gap-3">
                  <DepartmentIcon icon={d.icon} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{titleCase(d.kind)}</p>
                  </div>
                  {d.status === "archived" ? <Badge variant="muted">Archived</Badge> : null}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {d.head ? (
                    <>
                      <UserAvatar name={d.head.name || d.head.email} src={publicStorageUrl("avatars", d.head.avatar_path)} className="size-6" />
                      <span className="truncate">{d.head.name || d.head.email}</span>
                      <span className="text-xs text-muted-foreground">Head</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No head appointed</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><UsersRound className="size-3.5" />{d.members} people</span>
                  <span className="inline-flex items-center gap-1"><CheckCircle2 className="size-3.5" />{d.tasks_completed}/{d.tasks_total} tasks</span>
                  <span className={cn("inline-flex items-center gap-1", d.tasks_overdue > 0 && "text-destructive")}><AlarmClock className="size-3.5" />{d.tasks_overdue} overdue</span>
                </div>
                <div className="mt-auto space-y-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs"><span>Progress</span><span className="tabular">{d.progress_pct}%</span></div>
                    <Progress value={d.progress_pct} />
                  </div>
                  {d.tasks_total ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs"><span>Tasks done</span><span className="tabular">{Math.round(taskPct)}%</span></div>
                      <Progress value={taskPct} />
                    </div>
                  ) : null}
                  {d.budget && d.budget.allocated > 0 ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>Budget used</span>
                        <span className="tabular">{formatCurrency(d.budget.approved, event.currency)} / {formatCurrency(d.budget.allocated, event.currency)}</span>
                      </div>
                      <Progress value={budgetPct} tone={budgetPct >= 100 ? "destructive" : budgetPct >= 75 ? "warning" : "lime"} />
                    </div>
                  ) : null}
                </div>
              </div>
            );
            return d.can_open ? (
              <Link key={d.id} href={`/events/${eventId}/departments/${d.id}`}>{card}</Link>
            ) : (
              <div key={d.id} title="You are not a member of this department">{card}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
