"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, LayoutDashboard, Megaphone, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/announcements", label: "News", icon: Megaphone },
  { href: "/notifications", label: "Alerts", icon: Bell },
];

/** Phones: a floating frosted-glass tab bar, like a native app. */
export function MobileDock({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const item = "liquid-press relative isolate flex flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl py-1.5 text-[10px] font-medium";
  return (
    <nav
      aria-label="Quick navigation"
      className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex items-stretch gap-1 rounded-3xl border bg-glass p-1.5 lg:hidden"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            data-liquid=""
            aria-current={active ? "page" : undefined}
            className={cn(item, active ? "bg-primary text-primary-foreground shadow-[0_8px_18px_-10px_var(--glow)]" : "text-muted-foreground")}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        );
      })}
      <button type="button" onClick={onMenu} data-liquid="" className={cn(item, "text-muted-foreground")}>
        <Menu className="size-5" />
        Menu
      </button>
    </nav>
  );
}
