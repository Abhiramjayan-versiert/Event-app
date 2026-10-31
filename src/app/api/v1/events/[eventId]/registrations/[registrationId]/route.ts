import type { NextRequest } from "next/server";
import { ApiError, authenticate, handle } from "@/lib/api/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string; registrationId: string }> }) {
  const { eventId, registrationId } = await params;
  return handle(request, { eventId }, async ({ setCredential }) => {
    const { admin, credential } = await authenticate(request, eventId, "registrations:read");
    setCredential(credential);
    const column = /^[0-9a-f-]{36}$/i.test(registrationId) ? "id" : "registration_number";
    const { data } = await admin
      .from("registrations")
      .select("id, registration_number, external_reference, participant_name, email, phone, participant_college, course, academic_year, category, registration_type, team_name, team_members, status, payable_amount, amount_paid, amount_refunded, currency, payment_status, payment_reference, custom_fields, created_at, confirmed_at, is_test, items:registration_items(item_name, category, quantity, unit_price, amount)")
      .eq("event_id", eventId)
      .eq(column, registrationId)
      .maybeSingle();
    if (!data) throw new ApiError(404, "not_found", "Registration not found.");
    return { body: { data } };
  });
}
