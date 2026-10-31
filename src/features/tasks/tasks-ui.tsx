"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { useLocalDateTimeFields } from "@/lib/use-local-datetime";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { format } from "date-fns";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import { TASK_MODULES, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, type TaskInput } from "@/lib/validations/task";
import { addTaskCommentAction, saveTaskAction, setTaskAssigneesAction, setTaskStatusAction } from "@/features/tasks/actions";
import { cn, formatDateTime, titleCase } from "@/lib/utils";

export type Opt = { id: string; name: string };
export type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  module: string;
  task_type: string | null;
  department: string | null;
  due_at: string | null;
  progress_pct: number;
  assignees: string[];
  overdue: boolean;
  subtasks: number;
};

export const PRIORITY_VARIANT: Record<string, "muted" | "outline" | "warning" | "destructive"> = { low: "muted", medium: "outline", high: "warning", urgent: "destructive" };

export function TaskDialog({
  eventId, taskId, defaults, departments, people, trigger, parentTaskId,
}: {
  eventId: string; taskId?: string; defaults?: Partial<TaskInput>; departments: Opt[]; people: Opt[]; trigger: React.ReactNode; parentTaskId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const form = useForm<TaskInput>({
    defaultValues: {
      title: "", description: "", department_id: departments.length === 1 ? departments[0].id : "", parent_task_id: parentTaskId ?? "",
      module: "general", task_type: "general", priority: "medium", start_at: "", due_at: "", location: "", assignees: [], ...defaults,
    },
  });
  useLocalDateTimeFields(form, ["start_at", "due_at"]);
  const assignees = form.watch("assignees") ?? [];
  const submit = form.handleSubmit((v) =>
    startTransition(async () => {
      const r = await saveTaskAction(eventId, taskId ?? null, v, new Date().getTimezoneOffset());
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      toast.success(r.message ?? "Saved");
      setOpen(false);
      setErrors({});
      if (!taskId) form.reset();
      router.refresh();
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{taskId ? "Edit task" : parentTaskId ? "New subtask" : "New task"}</DialogTitle>
          <DialogDescription>Assignees are notified immediately and reminded before the due date.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="t-title" label="Title" error={errors.title?.[0]} required className="sm:col-span-2"><Input id="t-title" {...form.register("title")} /></FormField>
          <FormField id="t-dept" label="Department" error={errors.department_id?.[0]}>
            <NativeSelect id="t-dept" {...form.register("department_id")}>
              <option value="">Event-wide (no department)</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="t-priority" label="Priority">
            <NativeSelect id="t-priority" {...form.register("priority")}>{TASK_PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</NativeSelect>
          </FormField>
          <FormField id="t-module" label="Workspace">
            <NativeSelect id="t-module" {...form.register("module")}>{TASK_MODULES.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</NativeSelect>
          </FormField>
          <FormField id="t-type" label="Type">
            <NativeSelect id="t-type" {...form.register("task_type")}>{TASK_TYPES.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</NativeSelect>
          </FormField>
          <FormField id="t-start" label="Start"><Input id="t-start" type="datetime-local" {...form.register("start_at")} /></FormField>
          <FormField id="t-due" label="Due" error={errors.due_at?.[0]}><Input id="t-due" type="datetime-local" {...form.register("due_at")} /></FormField>
          <FormField id="t-loc" label="Location" className="sm:col-span-2"><Input id="t-loc" {...form.register("location")} /></FormField>
          <FormField id="t-desc" label="Description" className="sm:col-span-2"><Textarea id="t-desc" rows={3} {...form.register("description")} /></FormField>
          {!taskId ? (
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium">Assign to</p>
              {people.length === 0 ? <p className="text-xs text-muted-foreground">Nobody in this event yet.</p> : (
                <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                  {people.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                      <Checkbox checked={assignees.includes(p.id)} onCheckedChange={(c) => form.setValue("assignees", c ? [...assignees, p.id] : assignees.filter((x) => x !== p.id))} />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>{taskId ? "Save" : "Create task"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TaskStatusSelect({ eventId, taskId, status, disabled, className }: { eventId: string; taskId: string; status: string; disabled?: boolean; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <NativeSelect
      aria-label="Task status"
      className={cn("h-8 text-xs", className)}
      value={status}
      disabled={disabled || pending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) =>
        startTransition(async () => {
          const r = await setTaskStatusAction(eventId, taskId, e.target.value);
          if (!r.ok) return void toast.error(r.error);
          router.refresh();
        })
      }
    >
      {TASK_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
    </NativeSelect>
  );
}

export function ProgressEditor({ eventId, taskId, status, progress, disabled }: { eventId: string; taskId: string; status: string; progress: number; disabled?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(progress);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={0} max={100} step={5} value={value} disabled={disabled || pending} onChange={(e) => setValue(Number(e.target.value))} className="flex-1 accent-[var(--brand-lime-dark)]" aria-label="Progress" />
      <span className="tabular w-10 text-right text-sm">{value}%</span>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || pending || value === progress}
        onClick={() =>
          startTransition(async () => {
            const r = await setTaskStatusAction(eventId, taskId, value === 100 ? "completed" : status === "not_started" && value > 0 ? "in_progress" : status, value);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Progress saved");
            router.refresh();
          })
        }
      >
        Save
      </Button>
    </div>
  );
}

export function TaskList({ eventId, rows }: { eventId: string; rows: TaskRow[] }) {
  const router = useRouter();
  const columns: ColumnDef<TaskRow, unknown>[] = [
    {
      accessorKey: "title",
      header: "Task",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <Link href={`/events/${eventId}/tasks/${row.original.id}`} className="font-medium hover:underline">{row.original.title}</Link>
          <p className="text-xs text-muted-foreground">{[row.original.department, row.original.task_type ? titleCase(row.original.task_type) : null, row.original.subtasks ? `${row.original.subtasks} subtasks` : null].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ row }) => (row.original.overdue ? <Badge variant="destructive">Overdue</Badge> : <Badge variant={row.original.status === "completed" ? "success" : "muted"}>{titleCase(row.original.status)}</Badge>) },
    { accessorKey: "priority", header: "Priority", filterFn: "equals", cell: ({ getValue }) => <Badge variant={PRIORITY_VARIANT[getValue<string>()]}>{titleCase(getValue<string>())}</Badge> },
    { accessorKey: "department", header: "Department", filterFn: "equals", cell: ({ getValue }) => getValue<string | null>() ?? "Event-wide" },
    { id: "assignees", header: "Assignees", accessorFn: (r) => r.assignees.join(", "), cell: ({ getValue }) => <span className="block max-w-48 truncate">{getValue<string>() || "—"}</span> },
    { accessorKey: "due_at", header: "Due", cell: ({ row }) => <span className={cn(row.original.overdue && "font-medium text-destructive")}>{row.original.due_at ? formatDateTime(row.original.due_at) : "—"}</span> },
    { accessorKey: "progress_pct", header: "Progress", cell: ({ getValue }) => <div className="flex w-28 items-center gap-2"><Progress value={getValue<number>()} /><span className="tabular text-xs">{getValue<number>()}%</span></div> },
  ];
  const depts = [...new Set(rows.map((r) => r.department).filter((d): d is string => Boolean(d)))].sort();
  return (
    <DataTable
      columns={columns}
      data={rows}
      pageSize={25}
      onRowClick={(r) => router.push(`/events/${eventId}/tasks/${r.id}`)}
      searchPlaceholder="Search tasks…"
      filters={[
        { columnId: "status", title: "Statuses", options: TASK_STATUSES.map((s) => ({ value: s, label: titleCase(s) })) },
        { columnId: "priority", title: "Priorities", options: TASK_PRIORITIES.map((s) => ({ value: s, label: titleCase(s) })) },
        ...(depts.length > 1 ? [{ columnId: "department", title: "Departments", options: depts.map((d) => ({ value: d, label: d })) }] : []),
      ]}
      exportConfig={{
        filename: "tasks",
        columns: [
          { key: "title", header: "Task" }, { key: "department", header: "Department" }, { key: "status", header: "Status" }, { key: "priority", header: "Priority" },
          { key: "due_at", header: "Due" }, { key: "progress_pct", header: "Progress" }, { key: "assignees", header: "Assignees" },
        ],
        map: (r) => ({ ...r, status: r.overdue ? "overdue" : r.status, assignees: r.assignees.join("; ") }),
      }}
      emptyTitle="No tasks"
      emptyDescription="Create tasks and assign them to people in the event."
    />
  );
}

export function TaskBoard({ eventId, rows, updatable }: { eventId: string; rows: TaskRow[]; updatable: string[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {TASK_STATUSES.map((status) => {
        const items = rows.filter((r) => r.status === status);
        return (
          <section key={status} className="flex flex-col rounded-lg border bg-muted/40">
            <header className="border-b px-3 py-2.5 text-sm font-semibold">{titleCase(status)} <span className="text-muted-foreground">({items.length})</span></header>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {items.map((t) => (
                <div key={t.id} className={cn("space-y-2 rounded-md border bg-card p-3", t.overdue && "border-destructive/50")}>
                  <Link href={`/events/${eventId}/tasks/${t.id}`} className="block text-sm font-medium hover:underline">{t.title}</Link>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={PRIORITY_VARIANT[t.priority]}>{titleCase(t.priority)}</Badge>
                    {t.overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                    {t.department ? <Badge variant="muted">{t.department}</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{t.due_at ? `Due ${formatDateTime(t.due_at)}` : "No due date"}{t.assignees.length ? ` · ${t.assignees.join(", ")}` : ""}</p>
                  {updatable.includes(t.id) ? <TaskStatusSelect eventId={eventId} taskId={t.id} status={t.status} /> : null}
                </div>
              ))}
              {items.length === 0 ? <p className="p-3 text-center text-xs text-muted-foreground">Empty</p> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function TaskCalendar({ eventId, rows, month }: { eventId: string; rows: TaskRow[]; month: string }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(y, m, 0).getDate();
  const cells = Array.from({ length: Math.ceil((startOffset + days) / 7) * 7 }, (_, i) => i - startOffset + 1);
  const byDay = new Map<number, TaskRow[]>();
  for (const t of rows) {
    if (!t.due_at) continue;
    const d = new Date(t.due_at);
    if (d.getFullYear() === y && d.getMonth() === m - 1) byDay.set(d.getDate(), [...(byDay.get(d.getDate()) ?? []), t]);
  }
  const today = new Date();
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="grid min-w-[760px] grid-cols-7 border-b text-center text-xs font-medium uppercase text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid min-w-[760px] grid-cols-7">
        {cells.map((day, i) => {
          const isToday = day === today.getDate() && m - 1 === today.getMonth() && y === today.getFullYear();
          return (
            <div key={i} className={cn("min-h-24 border-b border-r p-1.5 text-xs", (day < 1 || day > days) && "bg-muted/40")}>
              {day >= 1 && day <= days ? (
                <>
                  <span className={cn("inline-flex size-5 items-center justify-center rounded-full", isToday && "bg-primary font-semibold text-primary-foreground")}>{day}</span>
                  <div className="mt-1 space-y-1">
                    {(byDay.get(day) ?? []).slice(0, 4).map((t) => (
                      <Link key={t.id} href={`/events/${eventId}/tasks/${t.id}`} className={cn("block truncate rounded px-1 py-0.5", t.status === "completed" ? "bg-success-surface text-success-foreground line-through" : t.overdue ? "bg-destructive-surface text-destructive" : "bg-accent text-accent-foreground")}>
                        {format(new Date(t.due_at!), "HH:mm")} {t.title}
                      </Link>
                    ))}
                    {(byDay.get(day)?.length ?? 0) > 4 ? <span className="text-muted-foreground">+{byDay.get(day)!.length - 4} more</span> : null}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CommentForm({ eventId, taskId }: { eventId: string; taskId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await addTaskCommentAction(eventId, taskId, body);
          if (!r.ok) return void toast.error(r.error);
          setBody("");
          router.refresh();
        });
      }}
    >
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Write an update or question…" maxLength={5000} aria-label="Comment" />
      <Button type="submit" size="sm" loading={pending} disabled={!body.trim()}>Comment</Button>
    </form>
  );
}

export function AssigneesEditor({ eventId, taskId, people, current }: { eventId: string; taskId: string; people: Opt[]; current: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(current);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setSelected(current); }}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Change assignees</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Assignees</DialogTitle></DialogHeader>
        <div className="grid max-h-72 gap-1 overflow-y-auto rounded-md border p-2">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
              <Checkbox checked={selected.includes(p.id)} onCheckedChange={(c) => setSelected((s) => (c ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
              {p.name}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await setTaskAssigneesAction(eventId, taskId, selected);
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message ?? "Saved");
                setOpen(false);
                router.refresh();
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
