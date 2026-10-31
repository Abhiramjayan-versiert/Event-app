import Link from "next/link";
import { Pin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadAnnouncements } from "@/features/announcements/queries";
import { formatRelative } from "@/lib/utils";

/** Latest announcements addressed to the user (RLS decides what is visible). */
export async function AnnouncementsCard({ userId }: { userId: string }) {
  const items = await loadAnnouncements({ limit: 4 }, userId);
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Announcements</CardTitle>
        <Link href="/announcements" className="text-xs font-medium text-muted-foreground hover:text-foreground">View all →</Link>
      </CardHeader>
      <CardContent className="divide-y">
        {items.map((a) => (
          <div key={a.id} className="py-2.5 text-sm">
            <p className="flex items-center gap-1.5 font-medium">{a.pinned ? <Pin className="size-3 text-lime-dark" /> : null}{a.title}</p>
            <p className="line-clamp-2 text-muted-foreground">{a.body}</p>
            <p className="text-xs text-muted-foreground">{a.audience} · {formatRelative(a.published_at)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
