import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CertificateSettingsForm, CertificatesTable, IssuePanel, type CertRow } from "@/features/certificates/certificates-ui";
import type { CertificateSettings } from "@/features/certificates/pdf";

export const metadata = { title: "Certificates" };

export default async function CertificatesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event, permissions } = await getEventContext(eventId);
  if (!can(permissions, "registrations.view")) notFound();
  const supabase = await createClient();
  const [{ data: certs }, { data: settings }] = await Promise.all([
    supabase.from("certificates").select("id, code, kind, title, recipient_name, recipient_email, emailed_at, revoked_at").eq("event_id", eventId).order("issued_at", { ascending: false }).limit(2000),
    supabase.from("event_settings").select("branding").eq("event_id", eventId).single(),
  ]);
  const rows = (certs ?? []) as CertRow[];
  const certSettings = ((settings?.branding as { certificate?: CertificateSettings } | null)?.certificate ?? {}) as CertificateSettings;
  const canManage = can(permissions, "registrations.manage");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={event.name} title="Certificates" description="Participation and winner certificates with a QR code anyone can scan to verify." />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Issued" value={rows.length} highlight />
        <StatCard label="Winners" value={rows.filter((r) => r.kind === "winner").length} />
        <StatCard label="Emailed" value={rows.filter((r) => r.emailed_at).length} />
        <StatCard label="Revoked" value={rows.filter((r) => r.revoked_at).length} />
      </div>
      <IssuePanel eventId={eventId} canManage={canManage} />
      <Card>
        <CardHeader><CardTitle>Certificate details</CardTitle><CardDescription>Printed at the bottom of every certificate.</CardDescription></CardHeader>
        <CardContent><CertificateSettingsForm eventId={eventId} defaults={certSettings} canEdit={can(permissions, "event.manage")} /></CardContent>
      </Card>
      <CertificatesTable eventId={eventId} rows={rows} canManage={canManage} />
    </div>
  );
}
