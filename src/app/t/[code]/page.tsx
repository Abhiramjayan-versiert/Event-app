import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency, formatDateRange } from "@/lib/utils";
import { ticketUrl } from "@/features/public/ticket-email";
import { PrintButton } from "@/features/public/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your ticket", robots: { index: false, follow: false } };

type Ticket = {
  registration_number: string; participant_name: string; participant_college: string | null; team_name: string | null; team_size: number;
  status: string; payment_status: string; amount: number; amount_paid: number; currency: string; checked_in_at: string | null;
  ticket_code: string; is_test: boolean; items: string[];
  event: { name: string; starts_on: string; ends_on: string; venue: string | null; timezone: string; college: string; contact_email: string | null };
};

/** Public QR ticket. The unguessable code in the URL is the access key. */
export default async function TicketPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ new?: string }> }) {
  const { code } = await params;
  if (!/^[0-9a-f]{16}$/i.test(code)) notFound();
  const { data } = await createAdminClient().rpc("public_ticket", { p_code: code });
  const t = data as Ticket | null;
  if (!t) notFound();
  const fresh = (await searchParams).new === "1";
  const qr = await QRCode.toString(ticketUrl(t.ticket_code), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0A0A0A", light: "#FFFFFF" } });
  const due = Math.max(Number(t.amount) - Number(t.amount_paid), 0);

  const banner =
    t.checked_in_at ? { icon: CheckCircle2, tone: "bg-lime/20 text-foreground", text: `Checked in ${new Date(t.checked_in_at).toLocaleString("en-IN", { timeZone: t.event.timezone, dateStyle: "medium", timeStyle: "short" })}` }
    : t.status === "confirmed" ? { icon: CheckCircle2, tone: "bg-lime/20 text-foreground", text: "Confirmed. Show this QR code at the entrance." }
    : t.status === "cancelled" ? { icon: XCircle, tone: "bg-destructive/10 text-destructive", text: "This registration was cancelled." }
    : { icon: Clock, tone: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200", text: due > 0 ? `Payment pending: ${formatCurrency(due, t.currency)}. Pay at the registration desk or follow the organisers' instructions; your ticket is confirmed once paid.` : "Awaiting confirmation by the organisers." };
  const Icon = banner.icon;

  return (
    <main className="mx-auto min-h-screen max-w-md space-y-5 px-4 py-8 print:py-2">
      <div className="flex items-center justify-between print:hidden">
        <Logo />
        <PrintButton />
      </div>
      {fresh ? <p className="rounded-md bg-ink px-4 py-3 text-sm text-white">Registration received! Save this page, as it is your ticket. A copy has been emailed to you.</p> : null}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="bg-ink px-5 py-4 text-white">
          <p className="text-xs text-white/60">{t.event.college}</p>
          <h1 className="text-xl font-bold">{t.event.name}</h1>
          <p className="text-sm text-white/70">{formatDateRange(t.event.starts_on, t.event.ends_on)}{t.event.venue ? ` · ${t.event.venue}` : ""}</p>
        </div>
        <div className="space-y-4 p-5">
          <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${banner.tone}`}><Icon className="mt-0.5 size-4 shrink-0" />{banner.text}</div>
          <div className="mx-auto w-56 rounded-lg border bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} aria-label="Ticket QR code" role="img" />
          <p className="text-center font-mono text-sm tracking-widest">{t.ticket_code}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{t.participant_name}</dd>
            {t.participant_college ? <><dt className="text-muted-foreground">College</dt><dd>{t.participant_college}</dd></> : null}
            {t.team_name ? <><dt className="text-muted-foreground">Team</dt><dd>{t.team_name} ({t.team_size})</dd></> : null}
            <dt className="text-muted-foreground">Registration</dt><dd>{t.registration_number}</dd>
            <dt className="text-muted-foreground">Competitions</dt><dd>{t.items.join(", ")}</dd>
          </dl>
          {t.is_test ? <p className="text-center text-xs font-semibold uppercase text-destructive">Test registration: not valid for entry</p> : null}
        </div>
      </div>
      {t.event.contact_email ? <p className="text-center text-xs text-muted-foreground print:hidden">Questions? <a className="underline" href={`mailto:${t.event.contact_email}`}>{t.event.contact_email}</a></p> : null}
    </main>
  );
}
