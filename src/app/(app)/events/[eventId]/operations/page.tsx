import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Phone, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can, canAnywhere } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteRecordButton, RecordDialog } from "@/features/records/record-dialog";
import { getOptionSets } from "@/features/records/options";
import { cn, titleCase } from "@/lib/utils";

export const metadata = { title: "Operations" };
const TABS = ["venues", "vendors", "inventory", "contacts"] as const;

export default async function OperationsPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { eventId } = await params;
  const { tab: t } = await searchParams;
  const tab = TABS.find((x) => x === t) ?? "venues";
  const { permissions } = await getEventContext(eventId);
  const canView = can(permissions, "operations.view") || canAnywhere(permissions, "operations.update");
  if (!canView) notFound();
  const canManage = can(permissions, "operations.manage");
  const canUpdate = canManage || canAnywhere(permissions, "operations.update");
  const supabase = await createClient();
  const [venues, vendors, inventory, contacts, options] = await Promise.all([
    supabase.from("venues").select("*").eq("event_id", eventId).order("name"),
    supabase.from("vendors").select("*, department:departments(name)").eq("event_id", eventId).order("name"),
    supabase.from("inventory").select("*, department:departments(name), venue:venues(name), vendor:vendors(name)").eq("event_id", eventId).order("name"),
    supabase.from("emergency_contacts").select("*").eq("event_id", eventId).order("sort_order"),
    getOptionSets(eventId),
  ]);

  const addButton = {
    venues: canManage ? <RecordDialog kind="venue" eventId={eventId} trigger={<Button><Plus /> Venue</Button>} /> : null,
    vendors: canUpdate ? <RecordDialog kind="vendor" eventId={eventId} options={options} trigger={<Button><Plus /> Vendor</Button>} /> : null,
    inventory: canUpdate ? <RecordDialog kind="inventory" eventId={eventId} options={options} trigger={<Button><Plus /> Item</Button>} /> : null,
    contacts: canManage ? <RecordDialog kind="emergency_contact" eventId={eventId} trigger={<Button><Plus /> Contact</Button>} /> : null,
  }[tab];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations"
        description="Venues, vendors, equipment and the emergency directory. Departments maintain their own items; the master schedule is under Schedule."
        actions={<>{addButton}<Button variant="outline" asChild><Link href={`/events/${eventId}/schedule`}>Master schedule</Link></Button></>}
      />
      <nav className="flex gap-1 overflow-x-auto rounded-md bg-muted p-1">
        {TABS.map((x) => (
          <Link key={x} href={`/events/${eventId}/operations${x === "venues" ? "" : `?tab=${x}`}`} className={cn("whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium", tab === x ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {x === "contacts" ? "Emergency contacts" : titleCase(x)}
          </Link>
        ))}
      </nav>

      {tab === "venues" ? (
        (venues.data ?? []).length === 0 ? <EmptyState title="No venues yet" description="Add auditoriums, grounds and halls used by the event." /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {venues.data!.map((v) => (
              <div key={v.id} className="space-y-2 rounded-lg border bg-card p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold">{v.name}</p><p className="text-xs text-muted-foreground">{v.location ?? "—"}</p></div>
                  {v.status === "archived" ? <Badge variant="muted">Archived</Badge> : v.capacity ? <Badge variant="outline">{v.capacity} seats</Badge> : null}
                </div>
                {v.facilities ? <p className="text-muted-foreground">{v.facilities}</p> : null}
                {v.contact_person ? <p className="text-xs">{v.contact_person}{v.contact_phone ? ` · ${v.contact_phone}` : ""}</p> : null}
                {canManage ? (
                  <div className="flex justify-end gap-1">
                    <RecordDialog kind="venue" eventId={eventId} id={v.id} defaults={v} trigger={<Button variant="ghost" size="sm"><Pencil /> Edit</Button>} />
                    <DeleteRecordButton kind="venue" eventId={eventId} id={v.id} label={v.name} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === "vendors" ? (
        (vendors.data ?? []).length === 0 ? <EmptyState title="No vendors yet" description="Vendors can be linked to expense requests and inventory." /> : (
          <SimpleTable
            head={["Vendor", "Category", "Contact", "Department", "Rating", ""]}
            rows={vendors.data!.map((v) => [
              <span key="n"><span className="font-medium">{v.name}</span>{v.status === "archived" ? <Badge variant="muted" className="ml-2">Archived</Badge> : null}{v.tax_id ? <span className="block text-xs text-muted-foreground">GSTIN {v.tax_id}</span> : null}</span>,
              v.category ?? "—",
              <span key="c">{v.contact_person ?? "—"}<span className="block text-xs text-muted-foreground">{[v.phone, v.email].filter(Boolean).join(" · ")}</span></span>,
              v.department?.name ?? "—",
              v.rating ? "★".repeat(v.rating) : "—",
              canUpdate ? <RecordDialog key="e" kind="vendor" eventId={eventId} id={v.id} defaults={v} options={options} trigger={<Button variant="ghost" size="sm"><Pencil /> Edit</Button>} /> : null,
            ])}
          />
        )
      ) : null}

      {tab === "inventory" ? (
        (inventory.data ?? []).length === 0 ? <EmptyState title="No inventory yet" description="Track equipment, furniture and supplies, where they are and their status." /> : (
          <SimpleTable
            head={["Item", "Qty", "Status", "Department", "Venue", "Vendor", ""]}
            rows={inventory.data!.map((i) => [
              <span key="n" className="font-medium">{i.name}<span className="block text-xs font-normal text-muted-foreground">{i.category ?? ""}</span></span>,
              `${i.quantity} ${i.unit}`,
              <Badge key="s" variant={["arranged", "in_use", "returned"].includes(i.status) ? "success" : ["damaged", "lost"].includes(i.status) ? "destructive" : "warning"}>{titleCase(i.status)}</Badge>,
              i.department?.name ?? "—",
              i.venue?.name ?? "—",
              i.vendor?.name ?? "—",
              canUpdate ? (
                <span key="a" className="flex justify-end gap-1">
                  <RecordDialog kind="inventory" eventId={eventId} id={i.id} defaults={i} options={options} trigger={<Button variant="ghost" size="sm"><Pencil /></Button>} />
                  {canManage ? <DeleteRecordButton kind="inventory" eventId={eventId} id={i.id} label={i.name} /> : null}
                </span>
              ) : null,
            ])}
          />
        )
      ) : null}

      {tab === "contacts" ? (
        (contacts.data ?? []).length === 0 ? <EmptyState title="No emergency contacts" description="Add ambulance, security, fire, medical and key coordinator numbers." /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {contacts.data!.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-3 rounded-lg border bg-card p-4">
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{c.role}</p>
                  <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 font-medium hover:underline"><Phone className="size-3.5" />{c.phone}</a>
                  {c.alt_phone ? <p className="text-xs text-muted-foreground">Alt: {c.alt_phone}</p> : null}
                  {c.notes ? <p className="text-xs text-muted-foreground">{c.notes}</p> : null}
                </div>
                {canManage ? (
                  <div className="flex gap-1">
                    <RecordDialog kind="emergency_contact" eventId={eventId} id={c.id} defaults={c} trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit"><Pencil /></Button>} />
                    <DeleteRecordButton kind="emergency_contact" eventId={eventId} id={c.id} label={c.name} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">{head.map((h, i) => <th key={i} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b last:border-0">{r.map((c, j) => <td key={j} className="px-3 py-2.5 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
