"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";

const uuid = z.string().uuid();

export async function setRolePermissionAction(roleId: string, permissionId: string, granted: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(roleId).success || !uuid.safeParse(permissionId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("key").eq("id", roleId).single();
  if (role?.key === "super_admin") return { ok: false, error: "Super Admin always has every permission." };

  if (granted) {
    const { data: me } = await supabase.auth.getUser();
    const { error } = await supabase.from("role_permissions").insert({ role_id: roleId, permission_id: permissionId, granted_by: me.user?.id ?? null });
    if (error && error.code !== "23505") return fromDbError(error, "Could not grant the permission.");
  } else {
    const { data, error } = await supabase.from("role_permissions").delete().eq("role_id", roleId).eq("permission_id", permissionId).select("role_id");
    if (error) return fromDbError(error, "Could not revoke the permission.");
    if (!data?.length) return { ok: false, error: "Only a Super Admin can change the permission matrix." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  scope: z.enum(["event", "department"]),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  copy_from: z.string().uuid().optional().or(z.literal("")),
});

export async function createRoleAction(input: unknown): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const key = `custom_${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`.slice(0, 60);
  const supabase = await createClient();
  const { data: role, error } = await supabase
    .from("roles")
    .insert({ key, name: parsed.data.name, scope: parsed.data.scope, description: parsed.data.description ?? "", is_system: false, sort_order: 60 })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? { ok: false, error: "A role with this name already exists." } : fromDbError(error, "Only a Super Admin can create roles.");

  if (parsed.data.copy_from) {
    const { data: grants } = await supabase.from("role_permissions").select("permission_id").eq("role_id", parsed.data.copy_from);
    if (grants?.length) {
      await supabase.from("role_permissions").insert(grants.map((g) => ({ role_id: role.id, permission_id: g.permission_id })));
    }
  }
  revalidatePath("/settings");
  return { ok: true, message: `Role "${parsed.data.name}" created.` };
}

export async function deleteRoleAction(roleId: string): Promise<ActionResult> {
  if (!uuid.safeParse(roleId).success) return { ok: false, error: "Invalid role." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("roles").delete().eq("id", roleId).eq("is_system", false).select("id");
  if (error) {
    if (error.code === "23503") return { ok: false, error: "This role is assigned to people (now or historically). Remove its permissions instead." };
    return fromDbError(error, "Could not delete the role.");
  }
  if (!data?.length) return { ok: false, error: "System roles cannot be deleted." };
  revalidatePath("/settings");
  return { ok: true, message: "Role deleted." };
}
