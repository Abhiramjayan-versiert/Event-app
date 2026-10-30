import { createClient } from "@/lib/supabase/server";
import { requireEventPermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EventForm, toLocalInput } from "@/features/events/event-form";
import { EventAdmins, EventBranding, EventLifecycle, RegistrationSettingsForm, type EventAdminRow } from "@/features/events/event-settings-panels";
import { EVENT_CATEGORIES, CURRENCIES, type EventInput } from "@/lib/validations/event";

export const metadata = { title: "Event settings" };

export default async function EventSettingsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event, permissions } = await requireEventPermission(eventId, "event.manage");
  const supabase = await createClient();
  const [{ data: settings }, { data: admins }] = await Promise.all([
    supabase.from("event_settings").select("registration_settings").eq("event_id", eventId).single(),
    supabase
      .from("event_members")
      .select("id, started_at, user:profiles!event_members_user_id_fkey(full_name, email, avatar_path), role:roles!inner(key)")
      .eq("event_id", eventId)
      .eq("role.key", "event_admin")
      .is("ended_at", null),
  ]);

  const reg = (settings?.registration_settings ?? {}) as Record<string, unknown>;
  const social = (event.social_links ?? {}) as Record<string, string>;
  const defaults: Partial<EventInput> = {
    college_id: event.college_id,
    name: event.name,
    slug: event.slug,
    category: (EVENT_CATEGORIES as readonly string[]).includes(event.category) ? (event.category as EventInput["category"]) : "other",
    description: event.description ?? "",
    starts_on: event.starts_on,
    ends_on: event.ends_on,
    registration_opens_at: toLocalInput(event.registration_opens_at),
    registration_closes_at: toLocalInput(event.registration_closes_at),
    venue: event.venue ?? "",
    website_url: event.website_url ?? "",
    contact_email: event.contact_email ?? "",
    contact_phone: event.contact_phone ?? "",
    currency: (CURRENCIES as readonly string[]).includes(event.currency) ? (event.currency as EventInput["currency"]) : "INR",
    status: event.status === "archived" ? "completed" : event.status,
    social_links: { instagram: social.instagram ?? "", linkedin: social.linkedin ?? "", x: social.x ?? "", youtube: social.youtube ?? "", facebook: social.facebook ?? "" },
  };
  const adminRows: EventAdminRow[] = (admins ?? []).flatMap((m) =>
    m.user ? [{ membershipId: m.id, name: m.user.full_name, email: m.user.email, avatarPath: m.user.avatar_path, since: m.started_at }] : [],
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Event settings" description="Details, branding, registration rules and administrators." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Event details</CardTitle>
            <CardDescription>Including the public website URL that will send registrations.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Server-rendered datetime defaults use the server timezone; the form re-derives them on save from the browser. */}
            <EventForm eventId={event.id} colleges={event.college ? [{ id: event.college.id, name: event.college.name }] : []} defaults={defaults} />
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Lifecycle</CardTitle></CardHeader>
            <CardContent><EventLifecycle eventId={event.id} status={event.status} /></CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Branding</CardTitle>
              <CardDescription>Logo and banner for the workspace and reports.</CardDescription>
            </CardHeader>
            <CardContent><EventBranding eventId={event.id} logoPath={event.logo_path} bannerPath={event.banner_path} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Event administrators</CardTitle></CardHeader>
            <CardContent><EventAdmins eventId={event.id} admins={adminRows} canManage={can(permissions, "event.members.manage")} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Registration settings</CardTitle></CardHeader>
            <CardContent>
              <RegistrationSettingsForm
                eventId={event.id}
                defaults={{
                  duplicate_rule: (reg.duplicate_rule as RegistrationRule) ?? "email_per_category",
                  allow_team_registrations: reg.allow_team_registrations !== false,
                  max_team_size: Number(reg.max_team_size ?? 6),
                }}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

type RegistrationRule = "email_per_category" | "email_per_event" | "phone_per_category" | "none";
