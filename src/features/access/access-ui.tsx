"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { grantDepartmentAccessAction, revokeDepartmentAccessAction, setAllDepartmentsAction } from "@/features/access/actions";

export type AccessPerson = {
  userId: string;
  name: string;
  email: string;
  eventRoles: string[];
  allDepartments: boolean;
  /** Departments they are placed in (position label). */
  own: { departmentId: string; department: string; position: string }[];
  grants: { id: string; departmentId: string; department: string; access: "view" | "manage" }[];
};

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Saved");
      router.refresh();
    });
  return { pending, run };
}

export function AccessRow({ eventId, person, departments }: { eventId: string; person: AccessPerson; departments: { id: string; name: string }[] }) {
  const { pending, run } = useRun();
  const [dept, setDept] = useState("");
  const [level, setLevel] = useState<"view" | "manage">("view");
  const hasEventRole = person.eventRoles.length > 0;
  const placed = person.own.length > 0;
  const full = hasEventRole && (person.allDepartments || !placed);
  const taken = new Set([...person.own.map((o) => o.departmentId), ...person.grants.map((g) => g.departmentId)]);
  const options = departments.filter((d) => !taken.has(d.id));

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{person.name || person.email}</p>
          <p className="text-xs text-muted-foreground">
            {[...person.eventRoles, ...person.own.map((o) => `${o.position} · ${o.department}`)].join(" · ") || "No role"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {full ? <Badge variant="lime">All departments</Badge> : <Badge variant="muted">{placed ? "Own department only" : "Selected departments"}</Badge>}
          {hasEventRole && placed ? (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={person.allDepartments} disabled={pending} aria-label="Access to all departments"
                onCheckedChange={(v) => run(() => setAllDepartmentsAction(eventId, person.userId, v))} />
              All departments
            </label>
          ) : null}
        </div>
      </div>
      {!full ? (
        <div className="flex flex-wrap items-center gap-2">
          {person.grants.map((g) => (
            <span key={g.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
              {g.department} · {g.access === "manage" ? "Manage" : "View"}
              <button type="button" className="text-muted-foreground hover:text-destructive" disabled={pending} aria-label={`Remove access to ${g.department}`}
                onClick={() => run(() => revokeDepartmentAccessAction(eventId, g.id))}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          {options.length > 0 ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <NativeSelect className="h-8 w-full sm:w-48" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
                <option value="">Add a department…</option>
                {options.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
              <NativeSelect className="h-8 w-28" value={level} onChange={(e) => setLevel(e.target.value as "view" | "manage")} aria-label="Access level">
                <option value="view">View</option>
                <option value="manage">Manage</option>
              </NativeSelect>
              <Button size="sm" variant="outline" disabled={!dept || pending}
                onClick={() => run(async () => { const r = await grantDepartmentAccessAction(eventId, dept, person.userId, level); if (r.ok) setDept(""); return r; })}>
                <Plus /> Give access
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
