"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pin, Trash2, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/ui/avatar";
import { FormField } from "@/components/shared/form-field";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { AssignMemberDialog, type PersonOption, type RoleOption } from "@/features/departments/assign-member-dialog";
import {
  assignDepartmentMemberAction, deleteAnnouncementAction, endDepartmentAssignmentAction, postDepartmentAnnouncementAction, deleteDepartmentAssignmentAction,
} from "@/features/departments/actions";
import { announcementSchema, type AnnouncementInput } from "@/lib/validations/department";
import { publicStorageUrl } from "@/lib/storage";
import { formatDate, formatRelative } from "@/lib/utils";

export type MemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatarPath: string | null;
  position: "head" | "co_head" | "assistant_head" | "member";
  role: string;
  since: string;
};

const POSITION_LABEL = { head: "Head", co_head: "Co-head", assistant_head: "Assistant head", member: "Team member" } as const;

export function DepartmentTeam({
  eventId, departmentId, members, people, roles, canLead, canAddMembers, selfId, isSuperAdmin = false,
}: {
  eventId: string;
  departmentId: string;
  members: MemberRow[];
  people: PersonOption[];
  roles: RoleOption[];
  canLead: boolean;
  canAddMembers: boolean;
  selfId: string;
  isSuperAdmin?: boolean;
}) {
  const positions = canLead
    ? [{ value: "member", label: "Team member" }, { value: "assistant_head", label: "Assistant head" }, { value: "co_head", label: "Co-head (alongside the head)" }, { value: "head", label: "Head (replaces current head)" }]
    : [{ value: "member", label: "Team member" }];
  const memberIds = new Set(members.map((m) => m.userId));

  return (
    <div className="space-y-3">
      {members.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Nobody is assigned to this department yet.</p>
      ) : (
        <ul className="divide-y">
          {members.map((m) => {
            const removable = m.position === "member" ? canAddMembers : canLead;
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar name={m.name || m.email} src={publicStorageUrl("avatars", m.avatarPath)} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.name || m.email}{m.userId === selfId ? " (you)" : ""}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.role} · since {formatDate(m.since)}</p>
                  </div>
                  <Badge variant={m.position === "head" || m.position === "co_head" ? "lime" : m.position === "assistant_head" ? "default" : "muted"}>{POSITION_LABEL[m.position]}</Badge>
                </div>
                {removable ? (
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    destructive
                    title="Remove from department?"
                    description={`${m.name || m.email} will lose access granted by this position. The assignment stays in the history.`}
                    confirmLabel="Remove"
                    action={() => endDepartmentAssignmentAction(eventId, departmentId, m.id)}
                  >
                    <UserMinus /> Remove
                  </ConfirmButton>
                ) : null}
                {isSuperAdmin ? (
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    destructive
                    title="Delete this role?"
                    description={`${m.name || m.email}'s ${POSITION_LABEL[m.position].toLowerCase()} role is deleted completely, including from the history. Use Remove to revoke access but keep the record.`}
                    confirmLabel="Delete role"
                    action={() => deleteDepartmentAssignmentAction(eventId, departmentId, m.id)}
                  >
                    <Trash2 /> Delete
                  </ConfirmButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canAddMembers ? (
        <AssignMemberDialog
          trigger={<Button variant="outline" size="sm"><UserPlus /> {canLead ? "Assign person" : "Add team member"}</Button>}
          title={canLead ? "Assign to department" : "Add team member"}
          description="Choose someone already in the event, or enter a name and email."
          people={people.filter((p) => !memberIds.has(p.id))}
          positions={positions}
          roles={canLead ? roles : undefined}
          submit={(values) => assignDepartmentMemberAction(eventId, departmentId, values)}
        />
      ) : null}
    </div>
  );
}

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  priority: string;
  pinned: boolean;
  published_at: string;
  author: string;
  mine: boolean;
};

export function DepartmentAnnouncements({
  eventId, departmentId, announcements, canPost,
}: { eventId: string; departmentId: string; announcements: AnnouncementRow[]; canPost: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<AnnouncementInput>({
    resolver: zodResolver(announcementSchema),
    defaultValues: { title: "", body: "", priority: "normal", pinned: false },
  });
  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await postDepartmentAnnouncementAction(eventId, departmentId, values);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message ?? "Posted");
      form.reset();
      router.refresh();
    }),
  );

  return (
    <div className="space-y-4">
      {canPost ? (
        <form onSubmit={submit} className="space-y-3 rounded-md border p-3" noValidate>
          <FormField id="an-title" label="Title" error={form.formState.errors.title?.message}>
            <Input id="an-title" {...form.register("title")} />
          </FormField>
          <FormField id="an-body" label="Message" error={form.formState.errors.body?.message}>
            <Textarea id="an-body" rows={3} {...form.register("body")} />
          </FormField>
          <div className="flex flex-wrap items-center gap-4">
            <NativeSelect aria-label="Priority" className="h-8 w-36" {...form.register("priority")}>
              <option value="normal">Normal</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </NativeSelect>
            <div className="flex items-center gap-2">
              <Controller control={form.control} name="pinned" render={({ field }) => <Switch id="an-pin" checked={field.value} onCheckedChange={field.onChange} />} />
              <Label htmlFor="an-pin">Pin</Label>
            </div>
            <Button type="submit" size="sm" loading={pending} className="ml-auto">Post</Button>
          </div>
        </form>
      ) : null}
      {announcements.length === 0 ? (
        <p className="text-sm text-muted-foreground">No announcements yet.</p>
      ) : (
        <ul className="space-y-3">
          {announcements.map((a) => (
            <li key={a.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {a.pinned ? <Pin className="size-3.5 text-lime-dark" /> : null}
                  <p className="text-sm font-semibold">{a.title}</p>
                  {a.priority !== "normal" ? <Badge variant={a.priority === "urgent" ? "destructive" : "warning"}>{a.priority}</Badge> : null}
                </div>
                {a.mine ? (
                  <ConfirmButton
                    variant="ghost"
                    size="icon-sm"
                    destructive
                    aria-label="Delete announcement"
                    title="Delete announcement?"
                    description="This removes the announcement for everyone."
                    confirmLabel="Delete"
                    action={() => deleteAnnouncementAction(eventId, departmentId, a.id)}
                  >
                    <Trash2 />
                  </ConfirmButton>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">{a.author} · {formatRelative(a.published_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
