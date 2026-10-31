"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import type { ActionResult } from "@/lib/actions";

export type PersonOption = { id: string; name: string; email: string };
export type RoleOption = { key: string; name: string };

/**
 * Pick an existing teammate or enter a name + email (existing account or new
 * invitation). Used for department appointments and event roles.
 */
export function AssignMemberDialog({
  trigger, title, description, people, positions, roles, defaultPosition, submit,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  people: PersonOption[];
  positions?: { value: string; label: string }[];
  roles?: RoleOption[];
  defaultPosition?: string;
  submit: (values: Record<string, string>) => Promise<ActionResult<unknown>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"existing" | "new">(people.length ? "existing" : "new");
  const [values, setValues] = useState({ user_id: "", email: "", full_name: "", position: defaultPosition ?? positions?.[0]?.value ?? "", role_key: "" });
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, string> = { position: values.position, role_key: values.role_key };
    if (mode === "existing") payload.user_id = values.user_id;
    else Object.assign(payload, { email: values.email, full_name: values.full_name });
    startTransition(async () => {
      const result = await submit(payload);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message ?? "Saved");
      setOpen(false);
      setValues((v) => ({ ...v, user_id: "", email: "", full_name: "" }));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {people.length ? (
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
              {(["existing", "new"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-sm py-1.5 font-medium ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {m === "existing" ? "Existing user" : "New person (email)"}
                </button>
              ))}
            </div>
          ) : null}
          {mode === "existing" ? (
            <FormField id="a-user" label="Person" required>
              <NativeSelect id="a-user" value={values.user_id} onChange={set("user_id")} required>
                <option value="">Select a person…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name || p.email} — {p.email}</option>)}
              </NativeSelect>
            </FormField>
          ) : (
            <>
              <FormField id="a-name" label="Full name" required>
                <Input id="a-name" value={values.full_name} onChange={set("full_name")} required minLength={2} />
              </FormField>
              <FormField id="a-email" label="Email" hint="New people receive an invitation email." required>
                <Input id="a-email" type="email" value={values.email} onChange={set("email")} required />
              </FormField>
            </>
          )}
          {positions ? (
            <FormField id="a-position" label="Position">
              <NativeSelect id="a-position" value={values.position} onChange={set("position")}>
                {positions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </NativeSelect>
            </FormField>
          ) : null}
          {roles?.length ? (
            <FormField id="a-role" label="Role" hint={positions ? "Leave as default to use the role that matches the department type." : undefined}>
              <NativeSelect id="a-role" value={values.role_key} onChange={set("role_key")} required={!positions}>
                {positions ? <option value="">Default for this position</option> : <option value="">Select a role…</option>}
                {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </NativeSelect>
            </FormField>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
