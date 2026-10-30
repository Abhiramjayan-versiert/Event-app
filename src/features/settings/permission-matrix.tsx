"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { createRoleAction, deleteRoleAction, setRolePermissionAction } from "@/features/settings/actions";
import { titleCase } from "@/lib/utils";

type Role = { id: string; key: string; name: string; scope: string; is_system: boolean; description: string };
type Permission = { id: string; key: string; name: string; module: string; scope: string; description: string };

export function PermissionMatrix({ roles, permissions, grants }: { roles: Role[]; permissions: Permission[]; grants: string[] }) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(new Set(grants), (state: Set<string>, change: { key: string; on: boolean }) => {
    const next = new Set(state);
    if (change.on) next.add(change.key);
    else next.delete(change.key);
    return next;
  });
  const editableRoles = roles.filter((r) => r.key !== "super_admin");
  const modules = [...new Set(permissions.map((p) => p.module))];

  function toggle(role: Role, perm: Permission, on: boolean) {
    const key = `${role.id}:${perm.id}`;
    startTransition(async () => {
      setOptimistic({ key, on });
      const result = await setRolePermissionAction(role.id, perm.id, on);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b">
            <th className="w-72 px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Permission</th>
            {editableRoles.map((r) => (
              <th key={r.id} className="px-2 py-3 text-center align-bottom">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs font-semibold">{r.name}</span>
                  <Badge variant={r.is_system ? "muted" : "lime"} className="text-[10px]">{r.scope}</Badge>
                  {!r.is_system ? (
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      destructive
                      title={`Delete role "${r.name}"?`}
                      description="Roles that have ever been assigned cannot be deleted; remove their permissions instead."
                      confirmLabel="Delete"
                      action={() => deleteRoleAction(r.id)}
                      aria-label={`Delete ${r.name}`}
                    >
                      <Trash2 />
                    </ConfirmButton>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {modules.map((module) => (
            <ModuleRows key={module} module={module} permissions={permissions.filter((p) => p.module === module)} roles={editableRoles} granted={optimistic} onToggle={toggle} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleRows({
  module, permissions, roles, granted, onToggle,
}: { module: string; permissions: Permission[]; roles: Role[]; granted: Set<string>; onToggle: (r: Role, p: Permission, on: boolean) => void }) {
  return (
    <>
      <tr className="bg-muted/60">
        <td colSpan={roles.length + 1} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">{titleCase(module)}</td>
      </tr>
      {permissions.map((p) => (
        <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
          <td className="px-3 py-2">
            <p className="font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{p.key}</span>
              {p.scope === "department" ? " · applies within the role's department" : ""}
            </p>
          </td>
          {roles.map((r) => {
            const checked = granted.has(`${r.id}:${p.id}`);
            const applicable = !(p.scope === "college" && r.scope !== "college");
            return (
              <td key={r.id} className="px-2 py-2 text-center">
                {applicable ? (
                  <Checkbox checked={checked} onCheckedChange={(v) => onToggle(r, p, v === true)} aria-label={`${p.name} for ${r.name}`} />
                ) : (
                  <span className="text-muted-foreground/40" title="College permissions only apply to college roles">—</span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export function CreateRoleDialog({ roles }: { roles: Role[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState({ name: "", scope: "department", description: "", copy_from: "" });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createRoleAction(values);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message ?? "Role created");
      setOpen(false);
      setValues({ name: "", scope: "department", description: "", copy_from: "" });
      router.refresh();
    });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus /> New role</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create custom role</DialogTitle>
          <DialogDescription>Custom roles can be assigned in any event, e.g. &quot;Hospitality Coordinator&quot;.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <FormField id="role-name" label="Role name" required>
            <Input id="role-name" value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} required minLength={2} maxLength={60} />
          </FormField>
          <FormField id="role-scope" label="Assigned at">
            <NativeSelect id="role-scope" value={values.scope} onChange={(e) => setValues((v) => ({ ...v, scope: e.target.value }))}>
              <option value="department">Department level</option>
              <option value="event">Event level</option>
            </NativeSelect>
          </FormField>
          <FormField id="role-copy" label="Start with permissions from">
            <NativeSelect id="role-copy" value={values.copy_from} onChange={(e) => setValues((v) => ({ ...v, copy_from: e.target.value }))}>
              <option value="">No permissions</option>
              {roles.filter((r) => r.key !== "super_admin").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="role-desc" label="Description">
            <Input id="role-desc" value={values.description} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} maxLength={300} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Create role</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
