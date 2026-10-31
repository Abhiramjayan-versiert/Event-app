"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ShieldOff, X } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { addCollegeAdminAction, endCollegeMembershipAction } from "@/features/colleges/actions";
import { endEventMembershipAction } from "@/features/events/actions";
import { assignDepartmentMemberAction, assignEventRoleAction, endDepartmentAssignmentAction, removeUserFromEventAction } from "@/features/departments/actions";
import { formatDate } from "@/lib/utils";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { removeAllAccessAction } from "@/features/users/actions";

type Option = { id: string; name: string };
export type AccessData = {
  user: { id: string; email: string; full_name: string };
  colleges: Option[];
  events: (Option & { college: string })[];
  departments: (Option & { event_id: string })[];
  eventRoles: { key: string; name: string }[];
  departmentRoles: { key: string; name: string }[];
  collegeAccess: { id: string; college_id: string; college: string; role: string; since: string }[];
  eventAccess: { id: string; event_id: string; event: string; role: string; since: string }[];
  departmentAccess: { id: string; event_id: string; department_id: string; department: string; event: string; position: string; role: string; since: string }[];
};

const POSITIONS = [
  { value: "head", label: "Head" },
  { value: "assistant_head", label: "Assistant head" },
  { value: "member", label: "Member" },
];

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Saved");
      onOk?.();
      router.refresh();
    });
  return { pending, run };
}

function Row({ title, detail, onRemove, pending }: { title: React.ReactNode; detail: React.ReactNode; onRemove: () => void; pending: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button variant="ghost" size="sm" disabled={pending} onClick={onRemove} aria-label="Remove access">
        <X /> Remove
      </Button>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

export function UserAccessManager({ data }: { data: AccessData }) {
  const { pending, run } = useRun();
  const person = { email: data.user.email, full_name: data.user.full_name || data.user.email.split("@")[0] };

  const [college, setCollege] = useState("");
  const [event, setEvent] = useState("");
  const [eventRole, setEventRole] = useState(data.eventRoles[0]?.key ?? "");
  const [deptEvent, setDeptEvent] = useState("");
  const [dept, setDept] = useState("");
  const [position, setPosition] = useState("member");
  const [deptRole, setDeptRole] = useState("");
  const deptOptions = useMemo(() => data.departments.filter((d) => d.event_id === deptEvent), [data.departments, deptEvent]);
  const memberEvents = [...new Map([...data.eventAccess, ...data.departmentAccess].map((a) => [a.event_id, a.event])).entries()];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>College access</CardTitle>
          <CardDescription>College Admins manage a college, its users and all of its events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.collegeAccess.length === 0 ? <Empty>No college access.</Empty> : (
            <ul className="divide-y">
              {data.collegeAccess.map((a) => (
                <Row key={a.id} pending={pending} title={a.college} detail={`${a.role} · since ${formatDate(a.since)}`}
                  onRemove={() => run(() => endCollegeMembershipAction(a.college_id, a.id))} />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <div className="min-w-48 flex-1">
              <NativeSelect value={college} onChange={(e) => setCollege(e.target.value)} aria-label="College">
                <option value="">Choose a college…</option>
                {data.colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </div>
            <Button disabled={!college || pending} onClick={() => run(() => addCollegeAdminAction(college, person), () => setCollege(""))}>
              <Plus /> Make College Admin
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event roles</CardTitle>
          <CardDescription>Event-wide roles such as Event Admin or Viewer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.eventAccess.length === 0 ? <Empty>No event roles.</Empty> : (
            <ul className="divide-y">
              {data.eventAccess.map((a) => (
                <Row key={a.id} pending={pending} title={a.event} detail={`${a.role} · since ${formatDate(a.since)}`}
                  onRemove={() => run(() => endEventMembershipAction(a.event_id, a.id, "Removed by Super Admin"))} />
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <NativeSelect value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event">
              <option value="">Choose an event…</option>
              {data.events.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.college}</option>)}
            </NativeSelect>
            <NativeSelect value={eventRole} onChange={(e) => setEventRole(e.target.value)} aria-label="Role">
              {data.eventRoles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </NativeSelect>
            <Button disabled={!event || !eventRole || pending} onClick={() => run(() => assignEventRoleAction(event, { user_id: data.user.id, role_key: eventRole }), () => setEvent(""))}>
              <Plus /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Department assignments</CardTitle>
          <CardDescription>Department permissions apply only inside that department.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.departmentAccess.length === 0 ? <Empty>No department assignments.</Empty> : (
            <ul className="divide-y">
              {data.departmentAccess.map((a) => (
                <Row key={a.id} pending={pending}
                  title={<>{a.department} <span className="font-normal text-muted-foreground">· {a.event}</span></>}
                  detail={`${a.position.replace(/_/g, " ")} · ${a.role} · since ${formatDate(a.since)}`}
                  onRemove={() => run(() => endDepartmentAssignmentAction(a.event_id, a.department_id, a.id))} />
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_1fr_auto]">
            <NativeSelect value={deptEvent} onChange={(e) => { setDeptEvent(e.target.value); setDept(""); }} aria-label="Event">
              <option value="">Choose an event…</option>
              {data.events.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.college}</option>)}
            </NativeSelect>
            <NativeSelect value={dept} onChange={(e) => setDept(e.target.value)} disabled={!deptEvent} aria-label="Department">
              <option value="">Choose a department…</option>
              {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
            <NativeSelect value={position} onChange={(e) => setPosition(e.target.value)} aria-label="Position">
              {POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </NativeSelect>
            <NativeSelect value={deptRole} onChange={(e) => setDeptRole(e.target.value)} aria-label="Role">
              <option value="">Default role for the department</option>
              {data.departmentRoles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </NativeSelect>
            <Button disabled={!deptEvent || !dept || pending}
              onClick={() => run(() => assignDepartmentMemberAction(deptEvent, dept, { user_id: data.user.id, position, role_key: deptRole }), () => setDept(""))}>
              <Plus /> Assign
            </Button>
          </div>
        </CardContent>
      </Card>

      {(data.collegeAccess.length + data.eventAccess.length + data.departmentAccess.length) > 0 && (
        <Card className="border-destructive/40 lg:col-span-2">
          <CardHeader>
            <CardTitle>Remove all access</CardTitle>
            <CardDescription>
              Ends every college, event and department role this person holds, everywhere, and unassigns their open tasks. Their account and history stay,
              so you can give them a new, separate role afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConfirmButton
              variant="destructive"
              title={`Remove all of ${person.full_name}'s access?`}
              description="They will no longer see any college or event until you give them a new role."
              confirmLabel="Remove all access"
              destructive
              action={() => removeAllAccessAction(data.user.id)}
            >
              <ShieldOff /> Remove all access
            </ConfirmButton>
          </CardContent>
        </Card>
      )}

      {memberEvents.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Remove from an event completely</CardTitle>
            <CardDescription>Ends every role and department assignment in that event and unassigns their open tasks. History is kept.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {memberEvents.map(([id, name]) => (
              <Button key={id} variant="outline" size="sm" disabled={pending}
                onClick={() => { if (confirm(`Remove ${person.full_name} from ${name}?`)) run(() => removeUserFromEventAction(id, data.user.id)); }}>
                <Badge variant="muted">{name}</Badge> Remove
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
