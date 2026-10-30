"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useShell } from "@/components/layout/shell-context";
import { titleCase } from "@/lib/utils";

const LABELS: Record<string, string> = {
  dashboard: "Overview",
  colleges: "Colleges",
  events: "Events",
  users: "Users",
  settings: "Settings",
  profile: "Profile",
  audit: "Audit log",
  new: "New",
  edit: "Edit",
};

const UUID = /^[0-9a-f-]{36}$/i;

export function Breadcrumbs() {
  const pathname = usePathname();
  const { crumbs } = useShell();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm md:flex">
      {segments.map((segment, index) => {
        const href = "/" + segments.slice(0, index + 1).join("/");
        const label = UUID.test(segment) ? crumbs[segment] ?? "…" : LABELS[segment] ?? titleCase(decodeURIComponent(segment));
        const last = index === segments.length - 1;
        return (
          <span key={href} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /> : null}
            {last ? (
              <span className="truncate font-medium" aria-current="page">{label}</span>
            ) : (
              <Link href={href} className="truncate text-muted-foreground hover:text-foreground">{label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
