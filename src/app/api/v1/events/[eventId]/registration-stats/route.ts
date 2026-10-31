import type { NextRequest } from "next/server";
import { authenticate, handle } from "@/lib/api/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return handle(request, { eventId }, async ({ setCredential }) => {
    const { admin, credential } = await authenticate(request, eventId, "registrations:read");
    setCredential(credential);
    const { data } = await admin
      .from("registrations")
      .select("category, status, payment_status")
      .eq("event_id", eventId)
      .eq("is_test", credential.environment === "sandbox");
    const rows = data ?? [];
    const byCategory: Record<string, number> = {};
    for (const r of rows) if (r.status !== "cancelled") byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    return {
      body: {
        data: {
          total: rows.length,
          confirmed: rows.filter((r) => r.status === "confirmed").length,
          pending_payment: rows.filter((r) => r.payment_status === "pending" && r.status !== "cancelled").length,
          cancelled: rows.filter((r) => r.status === "cancelled").length,
          by_category: byCategory,
        },
      },
    };
  });
}
