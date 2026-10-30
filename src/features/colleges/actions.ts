"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { collegeSchema, collegeToRow } from "@/lib/validations/college";
import { inviteSchema } from "@/lib/validations/user";
import { findOrInviteUser } from "@/features/users/invite.server";

const uuid = z.string().uuid();

export async function createCollegeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = collegeSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("colleges").insert(collegeToRow(parsed.data)).select("id").single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A college with this code already exists.", fieldErrors: { code: ["Code already in use"] } };
    return fromDbError(error, "Could not create the college.");
  }
  revalidatePath("/colleges");
  revalidatePath("/dashboard");
  return { ok: true, data: { id: data.id }, message: "College created." };
}

export async function updateCollegeAction(id: string, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid college." };
  const parsed = collegeSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("colleges").update(collegeToRow(parsed.data)).eq("id", id).select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A college with this code already exists.", fieldErrors: { code: ["Code already in use"] } };
    return fromDbError(error, "Could not update the college.");
  }
  if (!data?.length) return { ok: false, error: "You do not have permission to edit this college." };
  revalidatePath(`/colleges/${id}`);
  revalidatePath("/colleges");
  return { ok: true, message: "College updated." };
}

export async function setCollegeArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid college." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("colleges")
    .update({ status: archived ? "archived" : "active" })
    .eq("id", id)
    .select("id");
  if (error) return fromDbError(error, "Could not change the archive status.");
  if (!data?.length) return { ok: false, error: "Only a Super Admin can archive or restore colleges." };
  revalidatePath(`/colleges/${id}`);
  revalidatePath("/colleges");
  return { ok: true, message: archived ? "College archived. Its records remain available for reporting." : "College restored." };
}

export async function setCollegeLogoAction(id: string, path: string | null): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid college." };
  if (path !== null && !path.startsWith(`colleges/${id}/`)) return { ok: false, error: "Invalid logo path." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("colleges").update({ logo_path: path }).eq("id", id).select("id");
  if (error || !data?.length) return fromDbError(error, "Could not update the logo.");
  revalidatePath(`/colleges/${id}`);
  return { ok: true };
}

export async function addCollegeAdminAction(collegeId: string, input: unknown): Promise<ActionResult<{ invited: boolean }>> {
  if (!uuid.safeParse(collegeId).success) return { ok: false, error: "Invalid college." };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_permission", { p_scope: "college", p_id: collegeId, p_permission: "college.users.manage" });
  if (!allowed) return { ok: false, error: "You do not have permission to manage this college's administrators." };

  let result: { userId: string; invited: boolean };
  try {
    result = await findOrInviteUser(parsed.data);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const { data: role } = await supabase.from("roles").select("id").eq("key", "college_admin").single();
  if (!role) return { ok: false, error: "College Admin role is missing." };
  const { error } = await supabase.from("college_members").insert({
    college_id: collegeId,
    user_id: result.userId,
    role_id: role.id,
    status: "active",
    invited_by: (await supabase.auth.getUser()).data.user?.id ?? null,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "This person is already a College Admin here." };
    return fromDbError(error, "Could not add the administrator.");
  }
  revalidatePath(`/colleges/${collegeId}`);
  return {
    ok: true,
    data: { invited: result.invited },
    message: result.invited ? `Invitation sent to ${parsed.data.email}.` : `${parsed.data.full_name} is now a College Admin.`,
  };
}

export async function endCollegeMembershipAction(collegeId: string, membershipId: string): Promise<ActionResult> {
  if (!uuid.safeParse(collegeId).success || !uuid.safeParse(membershipId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("college_members")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", membershipId)
    .eq("college_id", collegeId)
    .is("ended_at", null)
    .select("id");
  if (error) return fromDbError(error, "Could not remove the administrator.");
  if (!data?.length) return { ok: false, error: "Membership not found or already ended." };
  revalidatePath(`/colleges/${collegeId}`);
  return { ok: true, message: "Administrator removed. The assignment remains in the history." };
}
