"use client";

import { canSeeGlobalDashboard } from "@/lib/auth/types";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { globalNav, eventNav, type NavItem } from "@/config/navigation";
import { useEventPermissions } from "@/hooks/use-event-permissions";
import { useShell } from "@/components/layout/shell-context";
import { cn } from "@/lib/utils";

const EVENT_PATH = /^\/events\/([0-9a-f-]{36})(?:\/|$)/i;

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-liquid=""
      className={cn(
        "liquid-press relative isolate group flex h-10 items-center gap-3 overflow-hidden rounded-full px-3.5 text-sm font-medium",
        active ? "bg-sidebar-active text-sidebar-active-foreground shadow-[0_8px_18px_-8px_var(--glow)]" : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.title}</span>
    </Link>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { access, crumbs } = useShell();
  const eventId = pathname.match(EVENT_PATH)?.[1] ?? null;
  const perms = useEventPermissions(eventId);

  const global = globalNav(access).map((item) =>
    // Inside an event, "Events" should not stay highlighted over the event modules.
    eventId && item.href === "/events" ? { ...item, exact: true } : item,
  );
  const modules = eventId ? eventNav(eventId, perms, canSeeGlobalDashboard(access)) : [];

  return (
    <div className="flex h-full flex-col text-sidebar-foreground">
      <div className="flex h-16 items-center px-5">
        <Link href="/dashboard" onClick={onNavigate} aria-label="EVENT APP home">
          <Logo size="md" />
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        <div className="space-y-0.5">
          {global.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </div>
        {eventId ? (
          <div className="space-y-0.5">
            <p className="truncate px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted/70">
              {crumbs[eventId] ?? "Event"}
            </p>
            {perms === null
              ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="mx-3 my-2 h-5 animate-pulse rounded bg-sidebar-hover" />)
              : modules.map((item) => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}
          </div>
        ) : null}
      </nav>
      <div className="mx-3 mb-3 truncate rounded-2xl bg-sidebar-hover px-4 py-2.5 text-[11px] text-sidebar-muted">
        {access.is_super_admin ? "Super Admin" : "Signed in"} · {access.email}
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="glass fixed inset-y-3 left-3 z-30 hidden w-60 overflow-hidden rounded-2xl border bg-sidebar lg:block">
      <SidebarContent />
    </aside>
  );
}
