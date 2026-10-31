import type { NextRequest } from "next/server";
import { ApiError, authenticate, handle } from "@/lib/api/http";
import { fetchPayment, razorpayConfigured, verifyCheckoutSignature } from "@/lib/api/razorpay";
import { verifyPaymentSchema, zodDetails } from "@/lib/validations/api";

/**
 * Optional server-side confirmation the website can call right after
 * Razorpay Checkout succeeds. The checkout signature is verified AND the
 * payment is fetched from Razorpay before anything is marked paid.
 */
export async function POST(request: NextRequest) {
  return handle(request, { eventId: null }, async ({ setCredential, setEvent }) => {
    const { admin, credential } = await authenticate(request, null, "registrations:write");
    setCredential(credential);
    setEvent(credential.event_id);
    if (!razorpayConfigured()) throw new ApiError(503, "not_configured", "Online payments are not configured.");
    const parsed = verifyPaymentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "validation_failed", "Invalid payment confirmation.", zodDetails(parsed.error));
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = parsed.data;
    if (!verifyCheckoutSignature(orderId, paymentId, signature)) throw new ApiError(401, "invalid_signature", "Payment signature verification failed.");

    const { data: own } = await admin.from("payments").select("event_id").eq("provider", "razorpay").eq("provider_order_id", orderId).maybeSingle();
    if (!own || own.event_id !== credential.event_id) throw new ApiError(404, "not_found", "Unknown payment order.");

    const payment = await fetchPayment(paymentId);
    if (payment.order_id !== orderId) throw new ApiError(422, "mismatch", "Payment does not belong to this order.");
    const outcome = payment.status === "captured" ? "paid" : payment.status === "failed" ? "failed" : "pending";
    if (outcome === "pending") return { status: 202, body: { result: "pending", message: "Payment not captured yet; the webhook will confirm it." } };
    const { data, error } = await admin.rpc("apply_payment_event", {
      p_provider: "razorpay",
      p_provider_event_id: `verify:${paymentId}:${outcome}`,
      p_event_type: "server.verify",
      p_payload: payment as never,
      p_signature_valid: true,
      p_order_id: orderId,
      p_payment_id: paymentId,
      p_amount: payment.amount / 100,
      p_currency: payment.currency,
      p_method: payment.method,
      p_outcome: outcome,
    });
    if (error) throw new Error(error.message);
    return { body: data };
  });
}
