import {
  Building2, CalendarDays, CalendarRange, ClipboardList, FileText, Handshake, LayoutDashboard, Layers, ListChecks,
  Megaphone, Camera, Plug, Settings, ShieldCheck, Users, Wallet, BarChart3, Truck, UsersRound, type LucideIcon,
} from "lucide-react";
import type { AccessSummary } from "@/lib/auth/types";
import { canSeeGlobalDashboard } from "@/lib/auth/types";
import { canAnywhere, type EventPermissionSet, type PermissionKey } from "@/lib/permissions";

export type NavItem = { title: string; href: string; icon: LucideIcon; exact?: boolean };

export function globalNav(access: AccessSummary): NavItem[] {
  const collegeAdmin = canSeeGlobalDashboard(access);
  const items: NavItem[] = [{ title: "Overview", href: "/dashboard", icon: LayoutDashboard, exact: true }];
  if (collegeAdmin) items.push({ title: "Colleges", href: "/colleges", icon: Building2 });
  items.push({ title: "Events", href: "/events", icon: CalendarDays });
  if (collegeAdmin) items.push({ title: "Users", href: "/users", icon: Users });
  if (access.is_super_admin) {
    items.push({ title: "Audit log", href: "/audit", icon: ShieldCheck });
    items.push({ title: "Settings", href: "/settings", icon: Settings });
  }
  return items;
}

type EventModule = { title: string; segment: string; icon: LucideIcon; permission: PermissionKey; available: boolean };

/**
 * Event workspace modules. `available` marks modules whose screens are shipped;
 * unavailable modules are hidden so the navigation never leads to placeholders.
 */
export const EVENT_MODULES: EventModule[] = [
  { title: "Overview", segment: "", icon: LayoutDashboard, permission: "event.view", available: true },
  { title: "Departments", segment: "departments", icon: Layers, permission: "event.view", available: true },
  { title: "Team", segment: "team", icon: UsersRound, permission: "event.view", available: true },
  { title: "Registrations", segment: "registrations", icon: ClipboardList, permission: "registrations.view", available: true },
  { title: "Finance", segment: "finance", icon: Wallet, permission: "finance.view", available: true },
  { title: "Sponsorship", segment: "sponsorship", icon: Handshake, permission: "sponsors.view", available: false },
  { title: "Marketing", segment: "marketing", icon: Megaphone, permission: "marketing.view", available: false },
  { title: "Media & PR", segment: "media", icon: Camera, permission: "media.view", available: false },
  { title: "Tasks", segment: "tasks", icon: ListChecks, permission: "event.view", available: false },
  { title: "Operations", segment: "operations", icon: Truck, permission: "operations.view", available: false },
  { title: "Schedule", segment: "schedule", icon: CalendarRange, permission: "event.view", available: false },
  { title: "Documents", segment: "documents", icon: FileText, permission: "event.view", available: false },
  { title: "Reports", segment: "reports", icon: BarChart3, permission: "reports.view", available: false },
  { title: "Integrations", segment: "integrations", icon: Plug, permission: "integrations.manage", available: true },
  { title: "Settings", segment: "settings", icon: Settings, permission: "event.manage", available: true },
];

export function eventNav(eventId: string, perms: EventPermissionSet | null): NavItem[] {
  return EVENT_MODULES.filter((m) => m.available && canAnywhere(perms, m.permission)).map((m) => ({
    title: m.title,
    href: `/events/${eventId}${m.segment ? `/${m.segment}` : ""}`,
    icon: m.icon,
    exact: m.segment === "",
  }));
}
