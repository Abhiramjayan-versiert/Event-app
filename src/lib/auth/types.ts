export type AccessRole = {
  role_key: string;
  role_name: string;
  department_id: string | null;
  department_name: string | null;
  position: "head" | "assistant_head" | "member" | null;
};

export type AccessCollege = {
  id: string;
  name: string;
  code: string;
  status: string;
  logo_path: string | null;
  roles: string[];
};

export type AccessEvent = {
  id: string;
  name: string;
  slug: string;
  status: string;
  college_id: string;
  college_name: string;
  starts_on: string;
  ends_on: string;
  logo_path: string | null;
  roles: AccessRole[];
};

export type AccessSummary = {
  user_id: string;
  email: string;
  full_name: string;
  avatar_path: string | null;
  status: "active" | "suspended";
  is_super_admin: boolean;
  colleges: AccessCollege[];
  events: AccessEvent[];
};

export function canSeeGlobalDashboard(access: AccessSummary) {
  return access.is_super_admin || access.colleges.some((c) => c.roles.includes("college_admin"));
}

export function isCollegeAdmin(access: AccessSummary, collegeId: string) {
  return access.is_super_admin || access.colleges.some((c) => c.id === collegeId && c.roles.includes("college_admin"));
}
