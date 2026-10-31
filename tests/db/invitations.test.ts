import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwner, asUser, createUser, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let superAdmin: U, pending: U, accepted: U, plain: U;

beforeAll(async () => {
  [superAdmin, pending, accepted, plain] = await Promise.all([
    createUser("Invite Super", { superAdmin: true }), createUser("Invite Pending"), createUser("Invite Accepted"), createUser("Invite Plain"),
  ]);
  await asOwner((q) => q("update auth.users set invited_at = now(), email_confirmed_at = null, last_sign_in_at = null where id = $1", [pending.id]));
  await asOwner((q) => q("update auth.users set invited_at = now(), email_confirmed_at = now(), last_sign_in_at = now() where id = $1", [accepted.id]));
});
afterAll(() => pool.end());

describe("pending invitations", () => {
  it("lists only invited users who have not accepted, for Super Admins only", async () => {
    const rows = await asUser(superAdmin.id, (q) => q<{ user_id: string }>("select user_id from public.pending_invitations()"));
    const ids = rows.map((r) => r.user_id);
    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(accepted.id);
    await expectDenied(asUser(plain.id, (q) => q("select * from public.pending_invitations()")), /Only a Super Admin/);
  });
});
