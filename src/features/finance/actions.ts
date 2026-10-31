"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { EXPENSE_ACTIONS, expenseSchema, incomeSchema, paymentSchema, revisionSchema } from "@/lib/validations/finance";

const uuid = z.string().uuid();
const ids = (...v: string[]) => v.every((x) => uuid.safeParse(x).success);

function rpcError(error: { code?: string; message: string }, fallback: string): ActionResult<never> {
  if (["42501", "P0002", "22023", "23505"].includes(error.code ?? "")) return { ok: false, error: error.message };
  return fromDbError(error, fallback);
}

function refresh(eventId: string, expenseId?: string) {
  revalidatePath(`/events/${eventId}/finance`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/departments`, "layout");
  if (expenseId) revalidatePath(`/events/${eventId}/finance/expenses/${expenseId}`);
}

export async function recordIncomeAction(eventId: string, input: unknown): Promise<ActionResult> {
  if (!ids(eventId)) return { ok: false, error: "Invalid event." };
  const parsed = incomeSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("college_id").eq("id", eventId).single();
  if (!event) return { ok: false, error: "Event not found." };
  const v = parsed.data;
  const { error } = await supabase.from("financial_transactions").insert({
    event_id: eventId,
    college_id: event.college_id,
    kind: "income",
    direction: "in",
    category: v.category,
    amount: v.amount,
    occurred_on: v.occurred_on,
    payment_method: v.payment_method,
    payment_reference: v.payment_reference || null,
    description: v.description || null,
    notes: v.notes || null,
    status: v.verified ? "verified" : "pending",
    verified_at: v.verified ? new Date().toISOString() : null,
  });
  if (error) return fromDbError(error, "Could not record the income.");
  refresh(eventId);
  return { ok: true, message: v.verified ? "Income recorded and verified." : "Income recorded as pending verification." };
}

export async function setTransactionStatusAction(eventId: string, txnId: string, status: "verified" | "rejected"): Promise<ActionResult> {
  if (!ids(eventId, txnId) || !["verified", "rejected"].includes(status)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("financial_transactions").update({ status }).eq("id", txnId).eq("event_id", eventId).eq("status", "pending").select("id");
  if (error) return rpcError(error, "Could not update the transaction.");
  if (!data?.length) return { ok: false, error: "Only pending transactions can be verified or rejected, by finance managers." };
  refresh(eventId);
  return { ok: true, message: status === "verified" ? "Transaction verified." : "Transaction rejected." };
}

export async function reverseTransactionAction(eventId: string, txnId: string, reason: string): Promise<ActionResult> {
  if (!ids(eventId, txnId)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_transaction", { p_transaction: txnId, p_reason: reason.slice(0, 500) });
  if (error) return rpcError(error, "Could not reverse the transaction.");
  refresh(eventId);
  return { ok: true, message: "Reversal recorded. The original entry no longer counts in totals." };
}

export async function createExpenseAction(eventId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!ids(eventId)) return { ok: false, error: "Invalid event." };
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("college_id").eq("id", eventId).single();
  if (!event) return { ok: false, error: "Event not found." };
  const { data, error } = await supabase
    .from("expense_requests")
    .insert({
      event_id: eventId,
      college_id: event.college_id,
      department_id: v.department_id,
      title: v.title,
      category: v.category,
      requested_amount: v.requested_amount,
      vendor_id: v.vendor_id || null,
      description: v.description || null,
      required_by: v.required_by || null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) return fromDbError(error, "You cannot submit expenses for this department.");
  if (v.submit) {
    const { error: submitError } = await supabase.rpc("expense_transition", { p_expense: data.id, p_action: "submit" });
    if (submitError) return rpcError(submitError, "Saved as draft, but it could not be submitted.");
  }
  refresh(eventId, data.id);
  return { ok: true, data: { id: data.id }, message: v.submit ? "Expense request submitted for review." : "Draft saved." };
}

export async function updateExpenseDraftAction(eventId: string, expenseId: string, input: unknown): Promise<ActionResult> {
  if (!ids(eventId, expenseId)) return { ok: false, error: "Invalid request." };
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_requests")
    .update({
      title: v.title, category: v.category, requested_amount: v.requested_amount, vendor_id: v.vendor_id || null,
      description: v.description || null, required_by: v.required_by || null,
    })
    .eq("id", expenseId)
    .select("id, status");
  if (error) return fromDbError(error, "Could not save the request.");
  if (!data?.length) return { ok: false, error: "Only your own drafts or returned requests can be edited." };
  if (v.submit) {
    const action = data[0].status === "changes_requested" ? "resubmit" : "submit";
    const { error: submitError } = await supabase.rpc("expense_transition", { p_expense: expenseId, p_action: action });
    if (submitError) return rpcError(submitError, "Saved, but it could not be submitted.");
  }
  refresh(eventId, expenseId);
  return { ok: true, message: v.submit ? "Submitted for review." : "Saved." };
}

export async function expenseTransitionAction(eventId: string, expenseId: string, action: string, amount?: number | null, comment?: string): Promise<ActionResult> {
  const parsedAction = z.enum(EXPENSE_ACTIONS).safeParse(action);
  if (!ids(eventId, expenseId) || !parsedAction.success) return { ok: false, error: "Invalid request." };
  if (amount !== undefined && amount !== null && !(amount > 0)) return { ok: false, error: "Enter a valid amount." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("expense_transition", {
    p_expense: expenseId,
    p_action: parsedAction.data,
    p_amount: amount ?? undefined,
    p_comment: comment?.slice(0, 1000) || undefined,
  });
  if (error) return rpcError(error, "Could not update the request.");
  refresh(eventId, expenseId);
  return { ok: true, message: `Request ${String(data).replace(/_/g, " ")}.` };
}

export async function recordExpensePaymentAction(eventId: string, expenseId: string, input: unknown): Promise<ActionResult> {
  if (!ids(eventId, expenseId)) return { ok: false, error: "Invalid request." };
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_expense_payment", {
    p_expense: expenseId, p_amount: v.amount, p_paid_on: v.paid_on, p_method: v.method,
    p_reference: v.reference || undefined, p_notes: v.notes || undefined,
  });
  if (error) return rpcError(error, "Could not record the payment.");
  refresh(eventId, expenseId);
  return { ok: true, message: "Payment recorded in the ledger." };
}

export async function setEventBudgetAction(eventId: string, total: number): Promise<ActionResult> {
  if (!ids(eventId) || !(total >= 0)) return { ok: false, error: "Enter a valid amount." };
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("budgets").update({ total_amount: total, set_by: me.user?.id ?? null }).eq("event_id", eventId).select("id");
  if (error) return fromDbError(error, "Could not save the budget.");
  if (!data?.length) return { ok: false, error: "You do not have permission to set the event budget." };
  refresh(eventId);
  return { ok: true, message: "Event budget saved." };
}

export async function setAllocationAction(eventId: string, departmentId: string, amount: number): Promise<ActionResult> {
  if (!ids(eventId, departmentId) || !(amount >= 0)) return { ok: false, error: "Enter a valid amount." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_department_allocation", { p_department: departmentId, p_amount: amount });
  if (error) return rpcError(error, "Could not save the allocation.");
  refresh(eventId);
  return { ok: true, message: "Allocation saved." };
}

export async function setApprovalLimitAction(eventId: string, limit: number): Promise<ActionResult> {
  if (!ids(eventId) || !(limit >= 0)) return { ok: false, error: "Enter a valid amount." };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_permission", { p_scope: "event", p_id: eventId, p_permission: "budgets.manage" });
  if (!allowed) return { ok: false, error: "You do not have permission to change approval limits." };
  const { data: s } = await supabase.from("event_settings").select("approval_limits").eq("event_id", eventId).single();
  const limits = { ...((s?.approval_limits as Record<string, unknown>) ?? {}), requires_final_approval_above: limit, finance_review_limit: limit };
  const { data, error } = await supabase.from("event_settings").update({ approval_limits: limits as never }).eq("event_id", eventId).select("event_id");
  if (error || !data?.length) return fromDbError(error, "Only event managers can change approval limits.");
  refresh(eventId);
  return { ok: true, message: "Approval limit saved." };
}

export async function requestBudgetRevisionAction(eventId: string, input: unknown): Promise<ActionResult> {
  if (!ids(eventId)) return { ok: false, error: "Invalid event." };
  const parsed = revisionSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const [{ data: me }, { data: event }] = await Promise.all([supabase.auth.getUser(), supabase.from("events").select("college_id").eq("id", eventId).single()]);
  if (!event) return { ok: false, error: "Event not found." };
  let previous = 0;
  if (v.department_id) {
    const { data } = await supabase.rpc("event_departments_overview", { p_event: eventId });
    const row = (data as unknown as { id: string; budget: { allocated: number } | null }[] | null)?.find((d) => d.id === v.department_id);
    previous = Number(row?.budget?.allocated ?? 0);
  } else {
    const { data } = await supabase.from("budgets").select("total_amount").eq("event_id", eventId).maybeSingle();
    previous = Number(data?.total_amount ?? 0);
  }
  const { error } = await supabase.from("budget_revisions").insert({
    event_id: eventId,
    college_id: event.college_id,
    department_id: v.department_id || null,
    previous_amount: previous,
    requested_amount: v.requested_amount,
    reason: v.reason,
    requested_by: me.user?.id ?? null,
    status: "pending",
  });
  if (error) return fromDbError(error, "You cannot request a revision for this budget.");
  refresh(eventId);
  return { ok: true, message: "Revision requested. Budget managers have been notified." };
}

export async function decideRevisionAction(eventId: string, revisionId: string, approve: boolean, note?: string): Promise<ActionResult> {
  if (!ids(eventId, revisionId)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_budget_revision", { p_revision: revisionId, p_approve: approve, p_note: note?.slice(0, 500) || undefined });
  if (error) return rpcError(error, "Could not decide the revision.");
  refresh(eventId);
  return { ok: true, message: approve ? "Revision approved and applied." : "Revision rejected." };
}
