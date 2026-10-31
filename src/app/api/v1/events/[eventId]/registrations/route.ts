import type { NextRequest } from "next/server";
import { ApiError, authenticate, dbErrorToApi, handle, sha256 } from "@/lib/api/http";
import { apiRegistrationSchema, zodDetails } from "@/lib/validations/api";
import { createOrder, razorpayConfigured } from "@/lib/api/razorpay";

const PUBLIC_FIELDS =
  "id, registration_number, external_reference, participant_name, email, phone, participant_college, category, registration_type, team_name, status, payable_amount, amount_paid, currency, payment_status, created_at, is_test";

export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return handle(request, { eventId }, async ({ setCredential }) => {
    const { admin, credential } = await authenticate(request, eventId, "registrations:write");
    setCredential(credential);

    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      throw new ApiError(400, "idempotency_key_required", "Send a unique Idempotency-Key header (8–120 characters) with every registration.");
    }
    const raw = await request.text();
    if (raw.length > 64_000) throw new ApiError(413, "payload_too_large", "Request body is too large.");
    const requestHash = sha256(raw);

    const { data: previous } = await admin.rpc("api_idempotency_lookup", { p_credential: credential.credential_id, p_key: idempotencyKey, p_request_hash: requestHash });
    const prev = previous as { conflict: boolean; status?: number; body?: unknown } | null;
    if (prev?.conflict) throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request body.");
    if (prev) return { status: prev.status ?? 200, body: prev.body, summary: { replayed: true } };

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "invalid_json", "Request body must be JSON.");
    }
    const parsed = apiRegistrationSchema.safeParse(json);
    if (!parsed.success) throw new ApiError(400, "validation_failed", "The registration data is invalid.", zodDetails(parsed.error));

    const { data: created, error } = await admin.rpc("api_create_registration", { p_credential: credential.credential_id, p_payload: parsed.data as never });
    if (error) throw dbErrorToApi(error);
    const reg = created as unknown as { id: string; registration_number: string; amount: number; currency: string; test: boolean; payment_status: string };

    let payment: Record<string, unknown> | null = null;
    if (Number(reg.amount) > 0) {
      if (credential.environment === "sandbox") {
        const orderId = `sandbox_order_${reg.id.replace(/-/g, "").slice(0, 16)}`;
        await admin.rpc("api_attach_payment_order", { p_registration: reg.id, p_provider: "sandbox", p_order_id: orderId, p_amount: Number(reg.amount) });
        payment = { provider: "sandbox", order_id: orderId, amount: Number(reg.amount), currency: reg.currency, simulate_url: `/api/v1/events/${eventId}/registrations/${reg.id}/sandbox-pay` };
      } else if (razorpayConfigured()) {
        const order = await createOrder(Number(reg.amount), reg.currency, reg.registration_number, { registration_id: reg.id, event_id: eventId });
        await admin.rpc("api_attach_payment_order", { p_registration: reg.id, p_provider: "razorpay", p_order_id: order.id, p_amount: Number(reg.amount) });
        payment = { provider: "razorpay", order_id: order.id, amount: Number(reg.amount), currency: reg.currency, key_id: process.env.RAZORPAY_KEY_ID };
      } else {
        payment = { provider: null, message: "Online payments are not configured. Collect payment offline." };
      }
    }

    const body = { data: { ...reg, payment } };
    await admin.rpc("api_idempotency_store", { p_credential: credential.credential_id, p_key: idempotencyKey, p_request_hash: requestHash, p_status: 201, p_body: body as never });
    return { status: 201, body, summary: { registration: reg.registration_number, test: reg.test } };
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return handle(request, { eventId }, async ({ setCredential }) => {
    const { admin, credential } = await authenticate(request, eventId, "registrations:read");
    setCredential(credential);
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
    const perPage = Math.min(100, Math.max(1, Number(sp.get("per_page") ?? 50) || 50));
    let query = admin.from("registrations").select(PUBLIC_FIELDS, { count: "exact" }).eq("event_id", eventId).eq("is_test", credential.environment === "sandbox");
    const email = sp.get("email");
    if (email) query = query.eq("email", email.toLowerCase());
    const status = sp.get("payment_status");
    if (status) query = query.eq("payment_status", status as never);
    const externalRef = sp.get("external_reference");
    if (externalRef) query = query.eq("external_reference", externalRef);
    const { data, count, error } = await query.order("created_at", { ascending: false }).range((page - 1) * perPage, page * perPage - 1);
    if (error) throw new ApiError(400, "invalid_query", "Invalid query parameters.");
    return { body: { data: data ?? [], pagination: { page, per_page: perPage, total: count ?? 0 } } };
  });
}
