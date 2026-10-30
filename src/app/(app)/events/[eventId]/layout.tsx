import Image from "next/image";
import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { getEventContext } from "@/lib/auth/session";
import { Crumb } from "@/components/layout/shell-context";
import { StatusBadge } from "@/components/shared/status-badge";
import { publicStorageUrl } from "@/lib/storage";
import { formatDateRange } from "@/lib/utils";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event } = await getEventContext(eventId);
  const logo = publicStorageUrl("branding", event.logo_path);
  const banner = publicStorageUrl("branding", event.banner_path);

  return (
    <div className="space-y-8">
      <Crumb id={event.id} label={event.name} />
      {event.college ? <Crumb id={event.college.id} label={event.college.name} /> : null}
      <div className="overflow-hidden rounded-lg border bg-card">
        {banner ? (
          <div className="relative h-28 w-full bg-muted sm:h-36">
            <Image src={banner} alt="" fill className="object-cover" sizes="100vw" unoptimized priority />
          </div>
        ) : (
          <div className="h-2 w-full bg-primary" />
        )}
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink text-lg font-black text-lime">
            {logo ? <Image src={logo} alt="" fill className="object-cover" sizes="48px" unoptimized /> : event.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{event.name}</h1>
              <StatusBadge status={event.status} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {event.college ? (
                <Link href={`/colleges/${event.college.id}`} className="hover:text-foreground hover:underline">{event.college.name}</Link>
              ) : null}
              <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />{formatDateRange(event.starts_on, event.ends_on)}</span>
              {event.venue ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{event.venue}</span> : null}
            </div>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
