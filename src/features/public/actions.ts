"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrder, fetchPayment, razorpayConfigured, verifyCheckoutSignature } from "@/lib/api/razorpay";
import type { ActionResult } from "@/lib/actions";
import { publicRegistrationSchema } from "@/lib/validations/public";
import { sendTicketEmail } from "./ticket-email";

type Checkout = { key: string; order_id: string; amount: number; currency: string; name: string; prefill: { name: string; email: string; contact: string } };

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

export async function publicRegisterAction(eventId: string, input: unknown): Promise<ActionResult<{ ticket: string; checkout?: Checkout }>> {
  if (!z.string().uuid().safeParse(eventId).success) return { ok: false, error: "Invalid event." };
  const parsed = publicRegistrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const v = parsed.data;
  if (v.website) return { ok: false, error: "Please try again." };

  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("api_rate_limit", { p_bucket: `public-register:${await clientIp()}`, p_limit: 8, p_window_seconds: 600 });
  if (allowed === false) return { ok: false, error: "Too many registrations from this network. Please wait a few minutes." };

  const team = v.team_members.filter((m) => m.name);
  const payload = {
    participant: { name: v.name, email: v.email, phone: v.phone, college: v.college, course: v.course || undefined, academic_year: v.academic_year || undefined },
    items: v.competitions.map((c) => ({ competition_code: c })),
    registration_type: team.length ? "team" : "individual",
    team_name: team.length ? v.team_name || `${v.name}'s team` : undefined,
    team_members: team.map((m) => ({ name: m.name, email: m.email || undefined })),
  };
  const { data, error } = await admin.rpc("public_register", { p_event: eventId, p_payload: payload as never });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "You have already registered with this email for this competition." };
    if (["22023", "P0002"].includes(error.code ?? "")) return { ok: false, error: error.message };
    return { ok: false, error: "Registration failed. Please try again." };
  }
  const reg = data as { id: string; registration_number: string; status: string; amount: number; currency: string; ticket_code: string };
  const { data: ev } = await admin.from("events").select("name").eq("id", eventId).single();

  let checkout: Checkout | undefined;
  if (Number(reg.amount) > 0 && razorpayConfigured()) {
    try {
      const order = await createOrder(Number(reg.amount), reg.currency, reg.registration_number, { registration_id: reg.id, event_id: eventId });
      await admin.rpc("api_attach_payment_order", { p_registration: reg.id, p_provider: "razorpay", p_order_id: order.id, p_amount: Number(reg.amount) });
      checkout = {
        key: process.env.RAZORPAY_KEY_ID!, order_id: order.id, amount: order.amount, currency: order.currency, name: ev?.name ?? "Registration",
        prefill: { name: v.name, email: v.email, contact: v.phone },
      };
    } catch {
      // Registration stands; the participant can pay at the desk.
    }
  }
  await sendTicketEmail({ email: v.email, participant_name: v.name, event_name: ev?.name ?? "the event", ticket_code: reg.ticket_code, registration_number: reg.registration_number, status: reg.status });
  return { ok: true, data: { ticket: reg.ticket_code.toLowerCase(), checkout } };
}

/** Confirms an online payment from the public page (signature + server-side fetch). */
export async function verifyPublicPaymentAction(ticket: string, orderId: string, paymentId: string, signature: string): Promise<ActionResult> {
  if (!/^[0-9a-f]{16}$/i.test(ticket) || !razorpayConfigured()) return { ok: false, error: "Invalid request." };
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) return { ok: false, error: "Payment could not be verified." };
  const admin = createAdminClient();
  const { data: own } = await admin
    .from("payments")
    .select("id, registration:registrations!inner(ticket_code, email, participant_name, registration_number, event:events(name))")
    .eq("provider", "razorpay")
    .eq("provider_order_id", orderId)
    .maybeSingle();
  if (!own || own.registration.ticket_code !== ticket.toUpperCase()) return { ok: false, error: "Unknown payment order." };
  const payment = await fetchPayment(paymentId);
  if (payment.order_id !== orderId) return { ok: false, error: "Payment does not match this registration." };
  const outcome = payment.status === "captured" ? "paid" : payment.status === "failed" ? "failed" : "pending";
  if (outcome === "pending") return { ok: true, message: "Payment received; confirmation can take a minute." };
  const { error } = await admin.rpc("apply_payment_event", {
    p_provider: "razorpay", p_provider_event_id: `verify:${paymentId}:${outcome}`, p_event_type: "public.verify", p_payload: payment as never,
    p_signature_valid: true, p_order_id: orderId, p_payment_id: paymentId, p_amount: payment.amount / 100, p_currency: payment.currency,
    p_method: payment.method, p_outcome: outcome,
  });
  if (error) return { ok: false, error: "Payment recorded but confirmation failed. Contact the organisers." };
  if (outcome === "paid") {
    const r = own.registration;
    await sendTicketEmail({ email: r.email, participant_name: r.participant_name, event_name: r.event?.name ?? "the event", ticket_code: r.ticket_code, registration_number: r.registration_number, status: "confirmed" });
  }
  return outcome === "paid" ? { ok: true, message: "Payment successful. Your ticket is confirmed." } : { ok: false, error: "The payment failed. You can try again or pay at the desk." };
}
