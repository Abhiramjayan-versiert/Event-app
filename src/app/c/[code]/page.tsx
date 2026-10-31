import { notFound } from "next/navigation";
import { BadgeCheck, ShieldX } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { formatDateRange } from "@/lib/utils";
import { CertificateDownload } from "@/features/certificates/download-button";
import type { CertificateData } from "@/features/certificates/pdf";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificate verification", robots: { index: false, follow: false } };

/** Public certificate verification + PDF download (the code is the key). */
export default async function CertificatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[0-9a-f]{12}$/i.test(code)) notFound();
  const { data } = await createAdminClient().rpc("public_certificate", { p_code: code });
  const c = data as CertificateData | null;
  if (!c) notFound();
  const verifyUrl = `${publicEnv.appUrl}/c/${c.code.toLowerCase()}`;
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <div className="space-y-4 rounded-xl border bg-card p-6">
        {c.revoked ? (
          <p className="flex items-center gap-2 font-semibold text-destructive"><ShieldX className="size-5" /> This certificate has been revoked by the organisers.</p>
        ) : (
          <p className="flex items-center gap-2 font-semibold"><BadgeCheck className="size-5 text-lime-dark" /> Verified certificate</p>
        )}
        <div className="space-y-1">
          <p className="text-2xl font-bold">{c.recipient_name}</p>
          <p className="text-muted-foreground">{c.title}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Event</dt><dd>{c.event.name}</dd>
          <dt className="text-muted-foreground">College</dt><dd>{c.event.college}</dd>
          <dt className="text-muted-foreground">Dates</dt><dd>{formatDateRange(c.event.starts_on, c.event.ends_on)}</dd>
          <dt className="text-muted-foreground">Certificate no.</dt><dd className="font-mono">{c.code}</dd>
        </dl>
        {!c.revoked ? <CertificateDownload data={c} verifyUrl={verifyUrl} /> : null}
      </div>
    </main>
  );
}
