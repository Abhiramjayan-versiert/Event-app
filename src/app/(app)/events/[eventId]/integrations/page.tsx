import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { publicEnv } from "@/lib/env";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ClearSandboxButton, CopyField, CreateKeyDialog, CredentialsList, IntegrationSettingsForm, TestConnectionButton, type CredentialRow,
} from "@/features/registrations/integrations-ui";
import { formatDateTime, formatRelative } from "@/lib/utils";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event, permissions } = await getEventContext(eventId);
  if (!can(permissions, "integrations.manage")) notFound();
  const supabase = await createClient();
  const [settings, creds, logs, tests] = await Promise.all([
    supabase.from("event_settings").select("integration_mode, last_sync_at, last_error, last_error_at").eq("event_id", eventId).single(),
    supabase.from("api_credentials").select("id, name, environment, key_prefix, created_at, last_used_at, revoked_at").eq("event_id", eventId).order("created_at", { ascending: false }),
    supabase.from("api_integration_logs").select("id, created_at, direction, method, endpoint, status_code, duration_ms, error, request_id").eq("event_id", eventId).order("created_at", { ascending: false }).limit(50),
    supabase.from("registrations").select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("is_test", true),
  ]);
  const base = publicEnv.appUrl.replace(/\/$/, "");
  const mode = (settings.data?.integration_mode ?? "sandbox") as "sandbox" | "production";
  const active = (creds.data ?? []).filter((c) => !c.revoked_at).length;

  const example = `curl -X POST ${base}/api/v1/events/${eventId}/registrations \\
  -H "Authorization: Bearer $EVENT_APP_API_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "external_reference": "web-000187",
    "participant": { "name": "Asha Rao", "email": "asha@example.com", "phone": "+91 98450 00000", "college": "RV College" },
    "registration_type": "individual",
    "items": [{ "competition_code": "HACK", "quantity": 1 }],
    "custom_fields": { "tshirt_size": "M" }
  }'`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect the public event website. It registers participants through this event's API; payments are confirmed only by verified gateway callbacks."
        actions={<Badge variant={active ? "success" : "muted"}>{active ? `${active} active key${active === 1 ? "" : "s"}` : "Not connected"}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Website & mode</CardTitle><CardDescription>Use sandbox while the website is being built. Switch to production with a live key at launch.</CardDescription></CardHeader>
          <CardContent><IntegrationSettingsForm eventId={eventId} websiteUrl={event.website_url ?? ""} mode={mode} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Status</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Last successful sync: </span>{settings.data?.last_sync_at ? formatRelative(settings.data.last_sync_at) : "never"}</p>
            <p><span className="text-muted-foreground">Last error: </span>{settings.data?.last_error ? `${settings.data.last_error} (${formatRelative(settings.data.last_error_at)})` : "none"}</p>
            <TestConnectionButton eventId={eventId} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1"><CardTitle>API keys</CardTitle><CardDescription>Keys are stored hashed and shown only once. Rotate by creating a new key, deploying it, then revoking the old one.</CardDescription></div>
            <CreateKeyDialog eventId={eventId} />
          </CardHeader>
          <CardContent><CredentialsList eventId={eventId} rows={(creds.data ?? []) as CredentialRow[]} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Endpoints</CardTitle><CardDescription>Configure the webhook in Razorpay → Settings → Webhooks (events: payment.captured, payment.failed, order.paid).</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">Event ID</p><CopyField value={eventId} label="Event ID" /></div>
            <div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">API base URL</p><CopyField value={`${base}/api/v1/events/${eventId}`} label="API base URL" /></div>
            <div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">Payment webhook URL</p><CopyField value={`${base}/api/v1/payments/webhook`} label="Webhook URL" /></div>
            <div className="flex items-center justify-between gap-2 pt-2">
              <span className="text-muted-foreground">Sandbox data</span>
              <ClearSandboxButton eventId={eventId} count={tests.count ?? 0} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Developer guide</CardTitle><CardDescription>The website can use any framework. All calls must come from its server.</CardDescription></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li><code className="text-foreground">GET /event-details</code> and <code className="text-foreground">GET /competitions</code> to render the event and its competitions.</li>
            <li><code className="text-foreground">POST /registrations</code> with an <code className="text-foreground">Idempotency-Key</code>. The response contains the amount and a payment order (Razorpay order id, or a sandbox order).</li>
            <li>Open Razorpay Checkout with that order id. Razorpay calls the webhook; EVENT APP verifies the signature and amount, then confirms the registration and books the income.</li>
            <li>Optionally call <code className="text-foreground">POST /api/v1/payments/verify</code> with the checkout response for an immediate server-side confirmation.</li>
            <li>In sandbox, call <code className="text-foreground">POST /registrations/{"{id}"}/sandbox-pay</code> (or <code className="text-foreground">?outcome=failed</code>) to simulate the gateway.</li>
          </ol>
          <pre className="overflow-x-auto rounded-md bg-ink p-4 font-mono text-xs leading-relaxed text-lime">{example}</pre>
          <p className="text-muted-foreground">
            Other endpoints: <code>GET /registrations?page=&amp;per_page=&amp;email=</code>, <code>GET /registrations/{"{id or REG-number}"}</code>, <code>GET /registration-stats</code>. Errors use{" "}
            <code>{`{ "error": { "code", "message", "details" } }`}</code> with 400/401/403/404/409/422/429/5xx. Full reference: docs/api.md in the repository.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Integration logs</CardTitle><CardDescription>Latest 50 API and webhook calls.</CardDescription></CardHeader>
        <CardContent>
          {(logs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2 pr-3">Time</th><th className="pr-3">Type</th><th className="pr-3">Request</th><th className="pr-3">Status</th><th className="pr-3">ms</th><th>Error</th></tr></thead>
                <tbody>
                  {logs.data!.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 text-xs">{formatDateTime(l.created_at)}</td>
                      <td className="pr-3">{l.direction}</td>
                      <td className="pr-3 font-mono text-xs">{l.method} {l.endpoint.replace(`/api/v1/events/${eventId}`, "")}</td>
                      <td className="pr-3"><StatusBadge status={l.status_code < 400 ? "verified" : l.status_code < 500 ? "pending" : "failed"} /> <span className="tabular text-xs">{l.status_code}</span></td>
                      <td className="tabular pr-3 text-xs">{l.duration_ms ?? "—"}</td>
                      <td className="max-w-xs truncate text-xs text-muted-foreground">{l.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
