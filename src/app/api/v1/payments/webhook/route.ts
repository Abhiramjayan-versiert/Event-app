import { NextResponse, type NextRequest } from "next/server";
import { clientIp, handle } from "@/lib/api/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature, webhookConfigured } from "@/lib/api/razorpay";

type RazorpayEvent = {
  event: string;
  payload?: {
    payment?: { entity?: { id: string; order_id: string; amount: number; currency: string; method?: string; status?: string; error_description?: string } };
    order?: { entity?: { id: string; amount_paid?: number; currency?: string } };
  };
};

/** Razorpay webhook. Only signed, verified events change payment state. */
export async function POST(request: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !webhookConfigured()) {
    return NextResponse.json({ error: { code: "not_configured", message: "Payment webhooks are not configured." } }, { status: 503 });
  }
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("api_rate_limit", { p_bucket: `webhook:${clientIp(request)}`, p_limit: 300, p_window_seconds: 60 });
  if (allowed === false) return NextResponse.json({ error: { code: "rate_limited" } }, { status: 429 });

  const raw = await request.text();
  const signatureValid = verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature"));
  let body: RazorpayEvent;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "invalid_json" } }, { status: 400 });
  }
  const payment = body.payload?.payment?.entity;
  const eventId = request.headers.get("x-razorpay-event-id") ?? `${body.event}:${payment?.id ?? "unknown"}`;
  const outcome = body.event === "payment.captured" || body.event === "order.paid" ? "paid" : body.event === "payment.failed" ? "failed" : "ignored";

  let eventIdForLog: string | null = null;
  if (payment?.order_id) {
    const { data } = await admin.from("payments").select("event_id").eq("provider", "razorpay").eq("provider_order_id", payment.order_id).maybeSingle();
    eventIdForLog = data?.event_id ?? null;
  }

  return handle(request, { eventId: eventIdForLog, direction: "webhook" }, async () => {
    if (!payment?.order_id) return { body: { result: "ignored" } };
    const { data, error } = await admin.rpc("apply_payment_event", {
      p_provider: "razorpay",
      p_provider_event_id: eventId,
      p_event_type: body.event,
      p_payload: body as never,
      p_signature_valid: signatureValid,
      p_order_id: payment.order_id,
      p_payment_id: payment.id,
      p_amount: payment.amount / 100,
      p_currency: payment.currency,
      p_method: payment.method ?? "razorpay",
      p_outcome: outcome,
    });
    if (error) throw new Error(error.message);
    const result = data as { result: string };
    // Invalid signatures get 401 so they are visible in Razorpay's dashboard; everything else is acknowledged.
    return { status: result.result === "rejected" && !signatureValid ? 401 : 200, body: result, summary: { event: body.event, result: result.result } };
  });
}
