import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext, requireAccess } from "@/lib/auth/session";
import { can, canInDepartment } from "@/lib/permissions";
import { Crumb } from "@/components/layout/shell-context";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { getEventPeople } from "@/features/departments/queries";
import { AssigneesEditor, CommentForm, PRIORITY_VARIANT, ProgressEditor, TaskDialog, TaskStatusSelect } from "@/features/tasks/tasks-ui";
import { deleteTaskAction } from "@/features/tasks/actions";
import { toLocalInput } from "@/features/events/event-form";
import { publicStorageUrl } from "@/lib/storage";
import { TASK_MODULES, TASK_TYPES, type TaskInput } from "@/lib/validations/task";
import { formatDateTime, formatRelative, titleCase } from "@/lib/utils";

export const metadata = { title: "Task" };

export default async function TaskPage({ params }: { params: Promise<{ eventId: string; taskId: string }> }) {
  const { eventId, taskId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) notFound();
  const access = await requireAccess();
  const { permissions } = await getEventContext(eventId);
  const supabase = await createClient();
  const { data: t } = await supabase
    .from("tasks")
    .select("*, department:departments(id, name), creator:profiles!tasks_created_by_fkey(full_name), parent:parent_task_id(id, title)")
    .eq("id", taskId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!t) notFound();
  const [assignments, subtasks, comments, people, depts] = await Promise.all([
    supabase.from("task_assignments").select("id, user_id, user:profiles!task_assignments_user_id_fkey(full_name, email, avatar_path)").eq("task_id", taskId).is("unassigned_at", null),
    supabase.from("tasks").select("id, title, status, due_at").eq("parent_task_id", taskId).order("created_at"),
    supabase.from("task_comments").select("id, body, created_at, author:profiles!task_comments_author_id_fkey(full_name, avatar_path)").eq("task_id", taskId).order("created_at"),
    getEventPeople(eventId),
    supabase.from("departments").select("id, name").eq("event_id", eventId).eq("status", "active").order("sort_order"),
  ]);

  const manageAll = can(permissions, "tasks.manage_all");
  const canManage = manageAll || (t.department_id ? canInDepartment(permissions, t.department_id, "tasks.manage") : false);
  const assigneeIds = (assignments.data ?? []).map((a) => a.user_id);
  const canUpdate = canManage || assigneeIds.includes(access.user_id);
  const overdue = t.status !== "completed" && t.due_at && new Date(t.due_at).getTime() < Date.now();
  const peopleOpts = people.map((p) => ({ id: p.id, name: p.name || p.email }));
  const deptOpts = (depts.data ?? []).filter((d) => manageAll || canInDepartment(permissions, d.id, "tasks.manage"));
  const defaults: Partial<TaskInput> = {
    title: t.title, description: t.description ?? "", department_id: t.department_id ?? "", priority: t.priority,
    module: (TASK_MODULES as readonly string[]).includes(t.module) ? (t.module as TaskInput["module"]) : "general",
    task_type: (TASK_TYPES as readonly string[]).includes(t.task_type ?? "") ? (t.task_type as TaskInput["task_type"]) : "general",
    start_at: toLocalInput(t.start_at), due_at: toLocalInput(t.due_at), location: t.location ?? "",
  };

  return (
    <div className="space-y-6">
      <Crumb id={t.id} label={t.title} />
      <PageHeader
        eyebrow={t.parent ? <Link href={`/events/${eventId}/tasks/${t.parent.id}`} className="hover:underline">Subtask of {t.parent.title}</Link> : t.department?.name ?? "Event-wide task"}
        title={<span className="flex flex-wrap items-center gap-2">{t.title}{overdue ? <Badge variant="destructive">Overdue</Badge> : null}</span>}
        description={`${titleCase(t.module)} · ${t.task_type ? titleCase(t.task_type) : "General"} · created by ${t.creator?.full_name ?? "—"}`}
        actions={
          canManage ? (
            <>
              <TaskDialog eventId={eventId} taskId={t.id} defaults={defaults} departments={deptOpts} people={peopleOpts} trigger={<Button variant="outline"><Pencil /> Edit</Button>} />
              <ConfirmButton variant="ghost" destructive title="Delete this task?" description="Subtasks and comments are deleted too." confirmLabel="Delete" action={() => deleteTaskAction(eventId, t.id)}>Delete</ConfirmButton>
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {t.description ? <p className="whitespace-pre-wrap">{t.description}</p> : <p className="text-muted-foreground">No description.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <p><span className="text-muted-foreground">Priority: </span><Badge variant={PRIORITY_VARIANT[t.priority]}>{titleCase(t.priority)}</Badge></p>
              <p><span className="text-muted-foreground">Due: </span>{t.due_at ? formatDateTime(t.due_at) : "—"}</p>
              <p><span className="text-muted-foreground">Start: </span>{t.start_at ? formatDateTime(t.start_at) : "—"}</p>
              <p><span className="text-muted-foreground">Location: </span>{t.location ?? "—"}</p>
              {t.completed_at ? <p><span className="text-muted-foreground">Completed: </span>{formatDateTime(t.completed_at)}</p> : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Status</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <TaskStatusSelect eventId={eventId} taskId={t.id} status={t.status} disabled={!canUpdate} />
            <ProgressEditor eventId={eventId} taskId={t.id} status={t.status} progress={t.progress_pct} disabled={!canUpdate} />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assignees</p>
              {(assignments.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Unassigned</p> : (
                <ul className="space-y-1.5">
                  {assignments.data!.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 text-sm"><UserAvatar name={a.user?.full_name || a.user?.email} src={publicStorageUrl("avatars", a.user?.avatar_path)} className="size-6" />{a.user?.full_name || a.user?.email}</li>
                  ))}
                </ul>
              )}
              {canManage ? <AssigneesEditor eventId={eventId} taskId={t.id} people={peopleOpts} current={assigneeIds} /> : null}
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Subtasks</CardTitle>
            {canManage && !t.parent_task_id ? (
              <TaskDialog eventId={eventId} parentTaskId={t.id} departments={deptOpts} people={peopleOpts} defaults={{ department_id: t.department_id ?? "", module: defaults.module }} trigger={<Button variant="outline" size="sm"><Plus /> Subtask</Button>} />
            ) : null}
          </CardHeader>
          <CardContent>
            {(subtasks.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No subtasks.</p> : (
              <ul className="divide-y">
                {subtasks.data!.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/events/${eventId}/tasks/${s.id}`} className={s.status === "completed" ? "text-muted-foreground line-through" : "hover:underline"}>{s.title}</Link>
                    <Badge variant={s.status === "completed" ? "success" : "muted"}>{titleCase(s.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Discussion</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(comments.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : (
              <ul className="space-y-3">
                {comments.data!.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <UserAvatar name={c.author?.full_name} src={publicStorageUrl("avatars", c.author?.avatar_path)} className="size-7" />
                    <div className="min-w-0 rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium">{c.author?.full_name ?? "Someone"} <span className="font-normal text-muted-foreground">· {formatRelative(c.created_at)}</span></p>
                      <p className="whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <CommentForm eventId={eventId} taskId={t.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
