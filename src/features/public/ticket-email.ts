import "server-only";

import { publicEnv } from "@/lib/env";
import { emailLayout, sendEmail } from "@/lib/email/send";

export function ticketUrl(code: string) {
  return `${publicEnv.appUrl}/t/${code.toLowerCase()}`;
}

/** Emails the participant a link to their QR ticket (best effort). */
export async function sendTicketEmail(t: { email: string; participant_name: string; event_name: string; ticket_code: string; registration_number: string; status: string }) {
  const confirmed = t.status === "confirmed";
  const { html, text } = emailLayout(
    confirmed ? `You're registered for ${t.event_name}` : `Registration received: ${t.event_name}`,
    [
      `Hi ${t.participant_name},`,
      confirmed
        ? `Your registration ${t.registration_number} is confirmed. Show the QR code on your ticket at the entrance.`
        : `We received your registration ${t.registration_number}. It will be confirmed once your payment is completed. Your ticket shows the latest status.`,
      `Ticket code: ${t.ticket_code}`,
    ],
    { label: "Open my ticket", url: ticketUrl(t.ticket_code) },
  );
  return sendEmail(t.email, `${confirmed ? "Your ticket" : "Registration received"} · ${t.event_name}`, html, text);
}
