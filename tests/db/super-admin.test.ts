import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { addCollegeMember, asOwner, asUser, createCollege, createUser, expectDenied, pool } from "./helpers";

const SA_EMAIL = "abhiramjayan72@gmail.com";
let saId: string;
type U = Awaited<ReturnType<typeof createUser>>;
let collegeAdmin: U, other: U;

beforeAll(async () => {
  saId = randomUUID();
  await asOwner((q) => q("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [saId, SA_EMAIL, JSON.stringify({ full_name: "Abhiram Jayan" })]));
  [collegeAdmin, other] = await Promise.all([createUser("Lock College Admin"), createUser("Lock Other")]);
  const college = await createCollege("Lock College");
  await addCollegeMember(college.id, collegeAdmin.id, "college_admin");
  await addCollegeMember(college.id, other.id, "college_admin");
});
afterAll(() => pool.end());

describe("single fixed Super Admin", () => {
  it("grants Super Admin only to the designated email, automatically", async () => {
    const [p] = await asOwner((q) => q<{ is_super_admin: boolean; full_name: string; email: string }>("select is_super_admin, full_name, email from public.profiles where id = $1", [saId]));
    expect(p).toEqual({ is_super_admin: true, full_name: "Contact Admin", email: "Contact Admin" });
    const [o] = await asOwner((q) => q<{ is_super_admin: boolean }>("select is_super_admin from public.profiles where id = $1", [other.id]));
    expect(o.is_super_admin).toBe(false);
  });

  it("does not let anyone, even the Super Admin or the database owner, assign or remove it", async () => {
    await expectDenied(asUser(saId, (q) => q("update public.profiles set is_super_admin = true where id = $1", [other.id])), /reserved/);
    await expectDenied(asOwner((q) => q("update public.profiles set is_super_admin = true where id = $1", [other.id])), /reserved/);
    await expectDenied(asOwner((q) => q("update public.profiles set is_super_admin = false where id = $1", [saId])), /reserved/);
    await expectDenied(asUser(collegeAdmin.id, (q) => q("update public.profiles set is_super_admin = true where id = $1", [collegeAdmin.id])), /Super Admin/);
  });

  it("cannot be suspended", async () => {
    await expectDenied(asOwner((q) => q("update public.profiles set status = 'suspended' where id = $1", [saId])), /cannot be suspended/);
  });

  it("shows Contact Admin to others and the real identity only to the Super Admin", async () => {
    const seen = await asUser(collegeAdmin.id, (q) => q<{ full_name: string; email: string; phone: string | null }>("select full_name, email, phone from public.profiles where id = $1", [saId]));
    expect(seen.every((r) => r.full_name === "Contact Admin" && r.email === "Contact Admin" && r.phone === null)).toBe(true);
    const [me] = await asUser(saId, (q) => q<{ a: { full_name: string; email: string; is_super_admin: boolean } }>("select public.my_access() a"));
    expect(me.a).toMatchObject({ full_name: "Abhiram Jayan", email: SA_EMAIL, is_super_admin: true });
  });

  it("stores the Super Admin's own edits privately and keeps the public row masked", async () => {
    await asUser(saId, (q) => q("update public.profiles set full_name = 'Abhiram J', phone = '+91 90000 00000' where id = $1", [saId]));
    const [p] = await asOwner((q) => q<{ full_name: string; phone: string | null }>("select full_name, phone from public.profiles where id = $1", [saId]));
    expect(p).toEqual({ full_name: "Contact Admin", phone: null });
    const [me] = await asUser(saId, (q) => q<{ p: { full_name: string; phone: string } }>("select public.my_profile() p"));
    expect(me.p).toMatchObject({ full_name: "Abhiram J", phone: "+91 90000 00000" });
    const [other] = await asUser(collegeAdmin.id, (q) => q<{ p: { full_name: string } }>("select public.my_profile() p"));
    expect(other.p.full_name).toBe("Lock College Admin");
  });
});
