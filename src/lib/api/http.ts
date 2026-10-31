import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ApiCredential = {
  credential_id: string;
  event_id: string;
  college_id: string;
  environment: "sandbox" | "production";
  scopes: string[];
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function serviceAvailable() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/** Validates the bearer key, event scope, permission scope and rate limit. */
export async function authenticate(request: NextRequest, eventId: string | null, scope: string) {
  if (!serviceAvailable()) throw new ApiError(503, "integration_unavailable", "The integration API is not configured on this server.");
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!/^eak_(live|test)_[a-z0-9]{10}_[A-Za-z0-9_-]{20,}$/.test(key)) throw new ApiError(401, "unauthorized", "Missing or malformed API key.");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_authenticate", { p_key_hash: sha256(key) });
  if (error) throw new ApiError(500, "server_error", "Authentication failed.");
  const credential = data as unknown as ApiCredential | null;
  if (!credential) throw new ApiError(401, "unauthorized", "Invalid or revoked API key.");
  if (eventId && credential.event_id !== eventId) throw new ApiError(403, "forbidden", "This key is not valid for that event.");
  if (!credential.scopes.includes(scope)) throw new ApiError(403, "forbidden", `This key lacks the ${scope} scope.`);

  const { data: allowed } = await admin.rpc("api_rate_limit", { p_bucket: `cred:${credential.credential_id}`, p_limit: 120, p_window_seconds: 60 });
  if (allowed === false) throw new ApiError(429, "rate_limited", "Too many requests. Retry in a minute.");
  return { admin, credential };
}

/**
 * Wraps a route handler: request id, JSON errors, timing and an integration
 * log entry for every call (successful or not).
 */
export async function handle(
  request: NextRequest,
  meta: { eventId: string | null; direction?: "inbound" | "webhook" },
  fn: (ctx: { requestId: string; setCredential: (c: ApiCredential) => void; setEvent: (id: string) => void }) => Promise<{ status?: number; body: unknown; summary?: Record<string, unknown> }>,
) {
  const requestId = randomUUID();
  const started = Date.now();
  let credential: ApiCredential | null = null;
  let eventId = meta.eventId;
  let status = 200;
  let body: unknown;
  let error: string | null = null;
  let summary: Record<string, unknown> = {};

  try {
    const result = await fn({ requestId, setCredential: (c) => (credential = c), setEvent: (id) => (eventId = id) });
    status = result.status ?? 200;
    body = result.body;
    summary = result.summary ?? {};
  } catch (e) {
    if (e instanceof ApiError) {
      status = e.status;
      body = { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } };
      error = e.message;
    } else {
      console.error(`[api ${requestId}]`, e);
      status = 500;
      body = { error: { code: "server_error", message: "An unexpected error occurred." } };
      error = (e as Error).message;
    }
  }

  if (serviceAvailable() && /^[0-9a-f-]{36}$/i.test(eventId ?? "")) {
    const c = credential as ApiCredential | null;
    await createAdminClient()
      .rpc("api_log", {
        p_event: eventId!,
        p_credential: c?.credential_id ?? null,
        p_direction: meta.direction ?? "inbound",
        p_method: request.method,
        p_endpoint: request.nextUrl.pathname,
        p_status: status,
        p_request_id: requestId,
        p_idempotency_key: request.headers.get("idempotency-key"),
        p_ip: clientIp(request),
        p_duration: Date.now() - started,
        p_error: error,
        p_summary: summary,
      } as never)
      .then(() => undefined, () => undefined);
  }

  const response = NextResponse.json(body, { status });
  response.headers.set("x-request-id", requestId);
  response.headers.set("cache-control", "no-store");
  if (status === 429) response.headers.set("retry-after", "60");
  return response;
}

export function dbErrorToApi(error: { code?: string; message: string }): ApiError {
  if (error.code === "23505") return new ApiError(409, "duplicate", "A registration already exists for this participant under the event's duplicate rule.");
  if (error.code === "22023") return new ApiError(422, "rejected", error.message);
  if (error.code === "23514" || error.code === "23502") return new ApiError(400, "validation_failed", "The registration data is invalid.");
  return new ApiError(500, "server_error", "Could not process the request.");
}
