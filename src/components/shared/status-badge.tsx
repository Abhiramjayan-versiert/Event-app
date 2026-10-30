import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/utils";

type Variant = "default" | "lime" | "success" | "muted" | "outline" | "warning" | "destructive";

const MAP: Record<string, Variant> = {
  // college / generic
  active: "success",
  inactive: "muted",
  archived: "muted",
  suspended: "destructive",
  invited: "warning",
  // event
  planning: "outline",
  registration_open: "lime",
  registration_closed: "muted",
  upcoming: "outline",
  live: "lime",
  completed: "default",
  // payments & registrations
  paid: "success",
  pending: "warning",
  failed: "destructive",
  refunded: "muted",
  partially_refunded: "muted",
  cancelled: "muted",
  not_required: "outline",
  confirmed: "success",
  waitlisted: "outline",
  // finance
  verified: "success",
  rejected: "destructive",
  reversed: "muted",
  draft: "muted",
  submitted: "warning",
  under_review: "warning",
  changes_requested: "warning",
  forwarded: "warning",
  approved: "success",
  partially_paid: "lime",
};

const LABELS: Record<string, string> = {
  registration_open: "Registration Open",
  registration_closed: "Registration Closed",
  not_required: "Free",
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return null;
  return (
    <Badge variant={MAP[status] ?? "outline"} className={className}>
      {status === "live" ? <span className="size-1.5 animate-pulse rounded-full bg-ink" /> : null}
      {LABELS[status] ?? titleCase(status)}
    </Badge>
  );
}
