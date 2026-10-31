"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { TASK_STATUSES, taskSchema } from "@/lib/validations/task";

const uuid = z.string().uuid();
const ids = (...v: string[]) => v.every((x) => uuid.safeParse(x).success);
const toIso = (local: string, offset: number) =>
  !local ? null : /[zZ]|[+-]\d{2}:?\d{2}$/.test(local) ? new Date(local).toISOString() : new Date(Date.parse(`${local}:00Z`) + offset * 60_000).toISOString();
const refresh = (eventId: string, taskId?: string) => {
  revalidatePath(`/events/${eventId}/tasks`);
  if (taskId) revalidatePath(`/events/${eventId}/tasks/${taskId}`);
  revalidatePath(`/events/${eventId}`, "layout");
};

export async function saveTaskAction(eventId: string, taskId: string | null, input: unknown, tzOffset: number): Promise<ActionResult<{ id: string }>> {
  if (!ids(eventId) || (taskId && !ids(taskId))) return { ok: false, error: "Invalid request." };
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const row = {
    title: v.title, description: v.description || null, department_id: v.department_id || null, module: v.module, task_type: v.task_type,
    priority: v.priority, start_at: toIso(v.start_at ?? "", tzOffset), due_at: toIso(v.due_at ?? "", tzOffset), location: v.location || null,
  };
  if (row.start_at && row.due_at && row.due_at < row.start_at) return { ok: false, error: "Due date must be after the start.", fieldErrors: { due_at: ["Must be after start"] } };
  const supabase = await createClient();

  let id = taskId;
  if (taskId) {
    const { data, error } = await supabase.from("tasks").update(row).eq("id", taskId).eq("event_id", eventId).select("id");
    if (error) return fromDbError(error, "Could not save the task.");
    if (!data?.length) return { ok: false, error: "You do not have permission to edit this task." };
  } else {
    const { data: event } = await supabase.from("events").select("college_id").eq("id", eventId).single();
    const { data, error } = await supabase
      .from("tasks")
      .insert({ ...row, parent_task_id: v.parent_task_id || null, event_id: eventId, college_id: event?.college_id ?? "" })
      .select("id")
      .single();
    if (error) return fromDbError(error, row.department_id ? "You cannot create tasks in that department." : "Choose a department you manage.");
    id = data.id;
    if (v.assignees.length) {
      const res = await setAssignees(eventId, id!, v.assignees);
      if (!res.ok) return res;
    }
  }
  refresh(eventId, id!);
  return { ok: true, data: { id: id! }, message: taskId ? "Task saved." : "Task created." };
}

async function setAssignees(eventId: string, taskId: string, userIds: string[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: task } = await supabase.from("tasks").select("college_id").eq("id", taskId).single();
  const { data: current } = await supabase.from("task_assignments").select("id, user_id").eq("task_id", taskId).is("unassigned_at", null);
  const have = new Set((current ?? []).map((a) => a.user_id));
  const want = new Set(userIds);
  const add = [...want].filter((u) => !have.has(u));
  const remove = (current ?? []).filter((a) => !want.has(a.user_id)).map((a) => a.id);
  if (add.length) {
    const { error } = await supabase.from("task_assignments").insert(add.map((user_id) => ({ task_id: taskId, event_id: eventId, college_id: task?.college_id ?? "", user_id })));
    if (error) return fromDbError(error, "You cannot assign this task.");
  }
  if (remove.length) {
    const { error } = await supabase.from("task_assignments").update({ unassigned_at: new Date().toISOString() }).in("id", remove);
    if (error) return fromDbError(error, "You cannot change assignees.");
  }
  return { ok: true };
}

export async function setTaskAssigneesAction(eventId: string, taskId: string, userIds: string[]): Promise<ActionResult> {
  if (!ids(eventId, taskId) || !userIds.every((u) => uuid.safeParse(u).success)) return { ok: false, error: "Invalid request." };
  const r = await setAssignees(eventId, taskId, userIds.slice(0, 30));
  if (!r.ok) return r;
  refresh(eventId, taskId);
  return { ok: true, message: "Assignees updated." };
}

export async function setTaskStatusAction(eventId: string, taskId: string, status: string, progress?: number): Promise<ActionResult> {
  const s = z.enum(TASK_STATUSES).safeParse(status);
  if (!ids(eventId, taskId) || !s.success) return { ok: false, error: "Invalid request." };
  const update: { status: (typeof TASK_STATUSES)[number]; progress_pct?: number } = { status: s.data };
  if (progress !== undefined) {
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) return { ok: false, error: "Progress must be 0–100." };
    update.progress_pct = progress;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").update(update).eq("id", taskId).eq("event_id", eventId).select("id");
  if (error) return fromDbError(error, "Could not update the task.");
  if (!data?.length) return { ok: false, error: "Only assignees and department managers can update this task." };
  refresh(eventId, taskId);
  return { ok: true, message: "Task updated." };
}

export async function addTaskCommentAction(eventId: string, taskId: string, body: string): Promise<ActionResult> {
  const text = body.trim();
  if (!ids(eventId, taskId) || text.length < 1 || text.length > 5000) return { ok: false, error: "Write a comment (up to 5000 characters)." };
  const supabase = await createClient();
  const [{ data: me }, { data: task }] = await Promise.all([supabase.auth.getUser(), supabase.from("tasks").select("college_id").eq("id", taskId).single()]);
  const { error } = await supabase.from("task_comments").insert({ task_id: taskId, event_id: eventId, college_id: task?.college_id ?? "", author_id: me.user?.id ?? null, body: text });
  if (error) return fromDbError(error, "You cannot comment on this task.");
  refresh(eventId, taskId);
  return { ok: true, message: "Comment added." };
}

export async function deleteTaskAction(eventId: string, taskId: string): Promise<ActionResult> {
  if (!ids(eventId, taskId)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").delete().eq("id", taskId).eq("event_id", eventId).select("id");
  if (error) return fromDbError(error, "Could not delete the task.");
  if (!data?.length) return { ok: false, error: "Only task managers can delete tasks." };
  refresh(eventId);
  return { ok: true, message: "Task deleted." };
}
