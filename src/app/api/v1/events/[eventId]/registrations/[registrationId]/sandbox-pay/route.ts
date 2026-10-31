import type { NextRequest } from "next/server";
import { ApiError, authenticate, handle } from "@/lib/api/http";

/** Sandbox only: simulates a verified gateway payment so integrations can be tested end to end. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string; registrationId: string }> }) {
  const { eventId, registrationId } = await params;
  return handle(request, { eventId }, async ({ setCredential }) => {
    const { admin, credential } = await authenticate(request, eventId, "registrations:write");
    setCredential(credential);
    if (credential.environment !== "sandbox") throw new ApiError(403, "forbidden", "Payment simulation is only available with sandbox keys.");
    const outcome = request.nextUrl.searchParams.get("outcome") === "failed" ? "failed" : "paid";
    const { data: payment } = await admin
      .from("payments")
      .select("provider_order_id, amount, currency")
      .eq("registration_id", registrationId)
      .eq("provider", "sandbox")
      .eq("is_test", true)
      .maybeSingle();
    if (!payment?.provider_order_id) throw new ApiError(404, "not_found", "No sandbox payment order for this registration.");
    const { data, error } = await admin.rpc("apply_payment_event", {
      p_provider: "sandbox",
      p_provider_event_id: `sandbox_${registrationId}_${outcome}`,
      p_event_type: outcome === "paid" ? "payment.captured" : "payment.failed",
      p_payload: { simulated: true } as never,
      p_signature_valid: true,
      p_order_id: payment.provider_order_id,
      p_payment_id: `sandbox_pay_${registrationId.slice(0, 8)}`,
      p_amount: Number(payment.amount),
      p_currency: payment.currency,
      p_method: "sandbox",
      p_outcome: outcome,
    });
    if (error) throw new ApiError(500, "server_error", "Simulation failed.");
    return { body: { data } };
  });
}
