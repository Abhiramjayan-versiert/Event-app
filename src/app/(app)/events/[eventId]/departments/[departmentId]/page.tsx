import { notFound } from "next/navigation";
import { AlarmClock, CheckCircle2, ListTodo, Pencil, PiggyBank, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext, requireAccess } from "@/lib/auth/session";
import { can, canInDepartment } from "@/lib/permissions";
import { Crumb } from "@/components/layout/shell-context";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DepartmentIcon } from "@/features/departments/department-icon";
import { DepartmentFormDialog } from "@/features/departments/department-form-dialog";
import { DepartmentAnnouncements, DepartmentTeam, type AnnouncementRow, type MemberRow } from "@/features/departments/department-panels";
import { getEventPeople, getRoleOptions } from "@/features/departments/queries";
import { BudgetRevisionDialog, ExpenseRequestDialog } from "@/features/finance/finance-dialogs";
import Link from "next/link";
import { DEPARTMENT_ICONS, type DepartmentInput } from "@/lib/validations/department";
import { formatCurrency, formatDate, formatDateTime, formatRelative, titleCase } from "@/lib/utils";

export default async function DepartmentPage({ params }: { params: Promise<{ eventId: string; departmentId: string }> }) {
  const { eventId, departmentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(departmentId)) notFound();
  const access = await requireAccess();
  const { event, permissions } = await getEventContext(eventId);
  if (!canInDepartment(permissions, departmentId, "department.view")) notFound();

  const supabase = await createClient();
  const { data: dept } = await supabase.from("departments").select("*").eq("id", departmentId).eq("event_id", eventId).maybeSingle();
  if (!dept) notFound();

  const [members, tasks, allocation, expenses, announcements, activity, people, roles] = await Promise.all([
    supabase
      .from("department_members")
      .select("id, position, assigned_at, ended_at, end_reason, user:profiles!department_members_user_id_fkey(id, full_name, email, avatar_path), role:roles(name)")
      .eq("department_id", departmentId)
      .order("assigned_at", { ascending: false }),
    supabase.from("tasks").select("id, title, status, priority, due_at").eq("department_id", departmentId).is("parent_task_id", null).order("due_at", { ascending: true, nullsFirst: false }),
    supabase.from("budget_allocations").select("allocated_amount").eq("department_id", departmentId).maybeSingle(),
    supabase.from("expense_requests").select("id, request_number, title, requested_amount, approved_amount, paid_amount, status, created_at").eq("department_id", departmentId).order("created_at", { ascending: false }),
    supabase.from("announcements").select("id, title, body, priority, pinned, published_at, created_by, author:profiles!announcements_created_by_fkey(full_name)").eq("department_id", departmentId).order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(20),
    supabase.from("activity_log").select("id, summary, created_at, actor:profiles!activity_log_actor_id_fkey(full_name)").eq("department_id", departmentId).order("created_at", { ascending: false }).limit(15),
    getEventPeople(eventId),
    getRoleOptions("department"),
  ]);

  const memberRows = members.data ?? [];
  const active: MemberRow[] = memberRows.filter((m) => !m.ended_at && m.user).map((m) => ({
    id: m.id, userId: m.user!.id, name: m.user!.full_name, email: m.user!.email, avatarPath: m.user!.avatar_path,
    position: m.position, role: m.role?.name ?? "—", since: m.assigned_at,
  }));
  active.sort((a, b) => ["head", "assistant_head", "member"].indexOf(a.position) - ["head", "assistant_head", "member"].indexOf(b.position));
  const history = memberRows.filter((m) => m.ended_at);

  const taskRows = tasks.data ?? [];
  const now = Date.now();
  const completed = taskRows.filter((t) => t.status === "completed").length;
  const overdue = taskRows.filter((t) => t.status !== "completed" && t.due_at && new Date(t.due_at).getTime() < now).length;

  const expenseRows = expenses.data ?? [];
  const canSeeBudget = allocation.data !== null || can(permissions, "finance.view") || canInDepartment(permissions, departmentId, "budgets.view");
  const allocated = Number(allocation.data?.allocated_amount ?? 0);
  const approved = expenseRows.filter((e) => ["approved", "partially_paid", "paid"].includes(e.status)).reduce((s, e) => s + Number(e.approved_amount ?? 0), 0);
  const paid = expenseRows.reduce((s, e) => s + Number(e.paid_amount), 0);
  const pendingExpenses = expenseRows.filter((e) => ["submitted", "under_review", "forwarded", "changes_requested"].includes(e.status));
  const usedPct = allocated ? (100 * approved) / allocated : 0;

  const canLead = can(permissions, "departments.manage");
  const canEdit = canLead || canInDepartment(permissions, departmentId, "department.manage");
  const canAddMembers = canInDepartment(permissions, departmentId, "department.members.manage");
  const canPost = can(permissions, "announcements.manage") || canInDepartment(permissions, departmentId, "announcements.post");
  const cur = event.currency;
  const canSubmitExpense = can(permissions, "expenses.submit") || canInDepartment(permissions, departmentId, "expenses.submit_department");
  const canRequestRevision = can(permissions, "budgets.manage") || canInDepartment(permissions, departmentId, "budgets.request");

  const defaults: DepartmentInput = {
    name: dept.name, kind: dept.kind, description: dept.description ?? "", status: dept.status, progress_pct: dept.progress_pct,
    icon: (DEPARTMENT_ICONS as readonly string[]).includes(dept.icon) ? (dept.icon as DepartmentInput["icon"]) : "layers",
  };
  const announcementRows: AnnouncementRow[] = (announcements.data ?? []).map((a) => ({
    id: a.id, title: a.title, body: a.body, priority: a.priority, pinned: a.pinned, published_at: a.published_at,
    author: a.author?.full_name || "Someone", mine: a.created_by === access.user_id,
  }));

  return (
    <div className="space-y-6">
      <Crumb id={dept.id} label={dept.name} />
      <PageHeader
        eyebrow={titleCase(dept.kind)}
        title={
          <span className="flex items-center gap-3">
            <DepartmentIcon icon={dept.icon} />
            <span className="truncate">{dept.name}</span>
            {dept.status === "archived" ? <Badge variant="muted">Archived</Badge> : null}
          </span>
        }
        description={dept.description ?? undefined}
        actions={
          canEdit ? (
            <DepartmentFormDialog
              eventId={eventId}
              departmentId={dept.id}
              defaults={defaults}
              canEditStructure={canLead}
              trigger={<Button variant="outline"><Pencil /> Edit</Button>}
            />
          ) : null
        }
      />

      <div className="space-y-1.5">
        <div className="flex justify-between text-sm"><span className="font-medium">Department progress</span><span className="tabular font-semibold">{dept.progress_pct}%</span></div>
        <Progress value={dept.progress_pct} />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Team" value={active.length} hint={`${active.filter((m) => m.position !== "member").length} in leadership`} icon={UsersRound} />
        <StatCard label="Pending tasks" value={taskRows.length - completed} hint={`${taskRows.length} total`} icon={ListTodo} />
        <StatCard label="Completed tasks" value={completed} icon={CheckCircle2} />
        <StatCard label="Overdue tasks" value={overdue} icon={AlarmClock} highlight={overdue > 0} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <CardDescription>Heads and assistant heads are appointed by event administrators. Every change is kept in the history.</CardDescription>
          </CardHeader>
          <CardContent>
            <DepartmentTeam
              eventId={eventId}
              departmentId={dept.id}
              members={active}
              people={people.map((p) => ({ id: p.id, name: p.name, email: p.email }))}
              roles={roles}
              canLead={canLead}
              canAddMembers={canAddMembers && dept.status === "active"}
              selfId={access.user_id}
            />
          </CardContent>
        </Card>

        {canSeeBudget ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PiggyBank className="size-4" /> Budget</CardTitle>
              <CardDescription>Approved spend against the department allocation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Allocated" value={formatCurrency(allocated, cur)} />
              <Row label="Approved expenses" value={formatCurrency(approved, cur)} />
              <Row label="Paid" value={formatCurrency(paid, cur)} />
              <Row label="Remaining" value={formatCurrency(allocated - approved, cur)} strong />
              <Row label="Pending requests" value={`${pendingExpenses.length} · ${formatCurrency(pendingExpenses.reduce((s, e) => s + Number(e.requested_amount), 0), cur)}`} />
              {canRequestRevision ? (
                <BudgetRevisionDialog
                  eventId={eventId}
                  departments={[{ id: dept.id, name: dept.name }]}
                  currentAmounts={{ [dept.id]: allocated }}
                  fixedDepartmentId={dept.id}
                  trigger={<Button variant="outline" size="sm" className="w-full">Request budget revision</Button>}
                />
              ) : null}
              {allocated > 0 ? (
                <div className="space-y-1 pt-1">
                  <Progress value={usedPct} tone={usedPct >= 100 ? "destructive" : usedPct >= 75 ? "warning" : "lime"} />
                  <p className="text-xs text-muted-foreground">
                    {usedPct >= 100 ? "Budget exceeded." : usedPct >= 90 ? "90% of the budget is committed." : usedPct >= 75 ? "75% of the budget is committed." : `${Math.round(usedPct)}% committed.`}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No budget allocated yet.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Tasks</CardTitle><CardDescription>Open and recent tasks of this department.</CardDescription></CardHeader>
          <CardContent>
            {taskRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet.</p>
            ) : (
              <ul className="divide-y">
                {taskRows.slice(0, 12).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{titleCase(t.priority)} priority{t.due_at ? ` · due ${formatDateTime(t.due_at)}` : ""}</p>
                    </div>
                    <Badge variant={t.status === "completed" ? "success" : t.due_at && new Date(t.due_at).getTime() < now ? "destructive" : "muted"}>
                      {t.status !== "completed" && t.due_at && new Date(t.due_at).getTime() < now ? "Overdue" : titleCase(t.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Expense requests</CardTitle>
              <CardDescription>Submitted by this department.</CardDescription>
            </div>
            {canSubmitExpense && dept.status === "active" ? (
              <ExpenseRequestDialog eventId={eventId} currency={cur} departments={[{ id: dept.id, name: dept.name }]} trigger={<Button size="sm">New request</Button>} />
            ) : null}
          </CardHeader>
          <CardContent>
            {expenseRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expense requests yet.</p>
            ) : (
              <ul className="divide-y">
                {expenseRows.slice(0, 10).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/events/${eventId}/finance/expenses/${e.id}`} className="block truncate font-medium hover:underline">{e.title}</Link>
                      <p className="text-xs text-muted-foreground">{e.request_number} · {formatDate(e.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular font-medium">{formatCurrency(e.requested_amount, cur)}</p>
                      <StatusBadge status={e.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Announcements</CardTitle><CardDescription>Visible to everyone in this department.</CardDescription></CardHeader>
          <CardContent>
            <DepartmentAnnouncements eventId={eventId} departmentId={dept.id} announcements={announcementRows} canPost={canPost} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent>
              {(activity.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ol className="divide-y">
                  {activity.data!.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">{a.summary}{a.actor?.full_name ? <span className="text-muted-foreground"> · {a.actor.full_name}</span> : null}</span>
                      <time className="shrink-0 text-xs text-muted-foreground">{formatRelative(a.created_at)}</time>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Assignment history</CardTitle><CardDescription>Previous heads and members.</CardDescription></CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No past assignments.</p>
              ) : (
                <ul className="divide-y">
                  {history.map((h) => (
                    <li key={h.id} className="py-2 text-sm">
                      <p className="font-medium">{h.user?.full_name || h.user?.email} <span className="font-normal text-muted-foreground">· {h.role?.name}</span></p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(h.assigned_at)} – {formatDate(h.ended_at)}{h.end_reason ? ` · ${h.end_reason}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "tabular font-semibold" : "tabular"}>{value}</span>
    </div>
  );
}
