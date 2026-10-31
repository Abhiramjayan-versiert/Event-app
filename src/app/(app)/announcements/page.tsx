import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { AnnouncementFeed, ComposeAnnouncement, type Audience } from "@/features/announcements/announcements-ui";
import { loadAnnouncements } from "@/features/announcements/queries";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const access = await requireAccess();
  const supabase = await createClient();
  const audiences: Audience[] = [];
  if (access.is_super_admin) {
    audiences.push({ label: "Everyone on the platform", value: "global", target: { scope: "global" } });
    const { data } = await supabase.from("colleges").select("id, name").neq("status", "archived").order("name");
    for (const c of data ?? []) audiences.push({ label: `College · ${c.name}`, value: `c:${c.id}`, target: { scope: "college", college_id: c.id } });
  } else {
    for (const c of access.colleges.filter((x) => x.roles.includes("college_admin"))) {
      audiences.push({ label: `College · ${c.name}`, value: `c:${c.id}`, target: { scope: "college", college_id: c.id } });
    }
  }
  const eventChecks = await Promise.all(
    access.events.map(async (e) => ((await supabase.rpc("check_permission", { p_scope: "event", p_id: e.id, p_permission: "announcements.manage" })).data ? e : null)),
  );
  for (const e of eventChecks.filter((x): x is NonNullable<typeof x> => x !== null)) {
    audiences.push({ label: `Event · ${e.name}`, value: `e:${e.id}`, target: { scope: "event", event_id: e.id } });
  }
  const items = await loadAnnouncements({ limit: 100 }, access.user_id);
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Announcements" description="Platform, college, event and department announcements addressed to you." actions={<ComposeAnnouncement audiences={audiences} />} />
      <AnnouncementFeed items={items} path="/announcements" />
    </div>
  );
}
