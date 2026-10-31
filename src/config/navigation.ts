import {
  Bell, Building2, CalendarDays, CalendarRange, ClipboardList, FileText, Handshake, LayoutDashboard, Layers, ListChecks,
  Megaphone, Camera, Plug, Settings, ShieldCheck, Users, Wallet, BarChart3, Truck, UsersRound, Lock, ScanLine, Gavel, Award, type LucideIcon,
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
  items.push({ title: "Announcements", href: "/announcements", icon: Megaphone });
  items.push({ title: "Notifications", href: "/notifications", icon: Bell });
  if (collegeAdmin) items.push({ title: "Reports", href: "/reports", icon: BarChart3 });
  if (collegeAdmin) items.push({ title: "Users", href: "/users", icon: Users });
  if (access.is_super_admin) {
    items.push({ title: "Activity & audit", href: "/audit", icon: ShieldCheck });
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
  { title: "Check-in", segment: "check-in", icon: ScanLine, permission: "registrations.checkin", available: true },
  { title: "Finance", segment: "finance", icon: Wallet, permission: "finance.view", available: true },
  { title: "Sponsorship", segment: "sponsorship", icon: Handshake, permission: "sponsors.view", available: true },
  { title: "Marketing", segment: "marketing", icon: Megaphone, permission: "marketing.view", available: true },
  { title: "Media & PR", segment: "media", icon: Camera, permission: "media.view", available: true },
  { title: "Judging", segment: "judging", icon: Gavel, permission: "event.view", available: true },
  { title: "Certificates", segment: "certificates", icon: Award, permission: "registrations.view", available: true },
  { title: "Tasks", segment: "tasks", icon: ListChecks, permission: "event.view", available: true },
  { title: "Operations", segment: "operations", icon: Truck, permission: "operations.view", available: true },
  { title: "Schedule", segment: "schedule", icon: CalendarRange, permission: "event.view", available: true },
  { title: "Announcements", segment: "announcements", icon: Megaphone, permission: "event.view", available: true },
  { title: "Documents", segment: "documents", icon: FileText, permission: "event.view", available: true },
  { title: "Reports", segment: "reports", icon: BarChart3, permission: "reports.view", available: true },
  { title: "Closing", segment: "closing", icon: Lock, permission: "event.close", available: true },
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
