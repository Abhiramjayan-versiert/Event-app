/**
 * Client/server mirror of the database permission matrix. The database (RLS +
 * SECURITY DEFINER functions) is the source of truth; these helpers only
 * decide what to *show*. Never rely on them for authorization.
 */
export const PERMISSIONS = {
  college: ["college.view", "college.manage", "college.users.manage", "college.events.create"],
  event: [
    "event.view", "event.manage", "event.close", "event.members.manage", "departments.manage",
    "finance.view", "finance.manage", "finance.review", "finance.approve", "budgets.manage", "expenses.submit",
    "registrations.view", "registrations.manage", "registrations.export", "registrations.checkin",
    "sponsors.view", "sponsors.manage", "media.view", "media.manage", "marketing.view", "marketing.manage",
    "tasks.view_all", "tasks.manage_all", "operations.view", "operations.manage", "announcements.manage",
    "documents.view_all", "judging.manage", "reports.view", "reports.export", "integrations.manage", "audit.view",
  ],
  department: [
    "department.view", "department.manage", "department.members.manage", "tasks.view", "tasks.manage",
    "expenses.view", "expenses.submit_department", "budgets.view", "budgets.request", "documents.view",
    "documents.upload", "announcements.post", "operations.update",
  ],
} as const;

export type CollegePermission = (typeof PERMISSIONS.college)[number];
export type EventPermission = (typeof PERMISSIONS.event)[number];
export type DepartmentPermission = (typeof PERMISSIONS.department)[number];
export type PermissionKey = CollegePermission | EventPermission | DepartmentPermission;

export type EventPermissionSet = {
  event: string[];
  departments: Record<string, string[]>;
  all_departments?: boolean;
};

export const EMPTY_PERMISSIONS: EventPermissionSet = { event: [], departments: {} };

/** Event-wide permission (also true for department-scoped keys granted event-wide). */
export function can(perms: EventPermissionSet | null | undefined, key: PermissionKey) {
  return Boolean(perms?.event.includes(key));
}

/** Permission inside a specific department: event-wide grant or a grant held in that department. */
export function canInDepartment(perms: EventPermissionSet | null | undefined, departmentId: string, key: PermissionKey) {
  if (!perms) return false;
  return perms.event.includes(key) || Boolean(perms.departments[departmentId]?.includes(key));
}

/** True if the permission is held event-wide or in at least one department. */
export function canAnywhere(perms: EventPermissionSet | null | undefined, key: PermissionKey) {
  if (!perms) return false;
  return perms.event.includes(key) || Object.values(perms.departments).some((list) => list.includes(key));
}

export function departmentIdsWith(perms: EventPermissionSet | null | undefined, key: PermissionKey) {
  if (!perms) return [];
  return Object.entries(perms.departments)
    .filter(([, list]) => list.includes(key))
    .map(([id]) => id);
}
