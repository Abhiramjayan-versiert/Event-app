import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  highlight = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  /** Lime emphasis for the most important metrics. */
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        highlight ? "border-transparent bg-ink text-white dark:bg-card dark:ring-1 dark:ring-primary/40" : "bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-xs font-medium uppercase tracking-wide", highlight ? "text-white/60" : "text-muted-foreground")}>{label}</span>
        {Icon ? <Icon className={cn("size-4", highlight ? "text-lime" : "text-muted-foreground")} /> : null}
      </div>
      <div className={cn("tabular text-2xl font-semibold tracking-tight", highlight && "text-lime")}>{value}</div>
      {hint ? <div className={cn("text-xs", highlight ? "text-white/60" : "text-muted-foreground")}>{hint}</div> : null}
    </div>
  );
}
