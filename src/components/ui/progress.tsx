import { cn } from "@/lib/utils";

function Progress({ value, className, tone = "lime" }: { value: number; className?: string; tone?: "lime" | "warning" | "destructive" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full transition-all", tone === "lime" && "bg-primary", tone === "warning" && "bg-warning", tone === "destructive" && "bg-destructive")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export { Progress };
