import { getEventContext, requireAccess } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { AnnouncementFeed, ComposeAnnouncement } from "@/features/announcements/announcements-ui";
import { loadAnnouncements } from "@/features/announcements/queries";

export const metadata = { title: "Announcements" };

export default async function EventAnnouncementsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const access = await requireAccess();
  const { event, permissions } = await getEventContext(eventId);
  const items = await loadAnnouncements({ eventId }, access.user_id);
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Announcements"
        description="Event-wide and department announcements. Department heads post to their department from the department page."
        actions={can(permissions, "announcements.manage") ? <ComposeAnnouncement audiences={[{ label: `Everyone in ${event.name}`, value: "event", target: { scope: "event", event_id: eventId } }]} /> : null}
      />
      <AnnouncementFeed items={items} path={`/events/${eventId}/announcements`} />
    </div>
  );
}
