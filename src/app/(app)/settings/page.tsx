import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { CreateRoleDialog, PermissionMatrix } from "@/features/settings/permission-matrix";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireSuperAdmin();
  const supabase = await createClient();
  const [roles, permissions, grants] = await Promise.all([
    supabase.from("roles").select("id, key, name, scope, is_system, description").order("sort_order").order("name"),
    supabase.from("permissions").select("id, key, name, module, scope, description").order("sort_order"),
    supabase.from("role_permissions").select("role_id, permission_id"),
  ]);
  if (roles.error || permissions.error || grants.error) return <ErrorState title="Could not load the permission matrix" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & permissions"
        description="The permission matrix enforced by the database for every college, event and department. Changes apply immediately."
        actions={<CreateRoleDialog roles={roles.data} />}
      />
      <PermissionMatrix
        roles={roles.data}
        permissions={permissions.data}
        grants={grants.data.map((g) => `${g.role_id}:${g.permission_id}`)}
      />
    </div>
  );
}
