"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { MoreHorizontal, Send, UserCheck, UserPlus, UserX } from "lucide-react";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormField } from "@/components/shared/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { UserAvatar } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { inviteUserAction, resendInvitationAction, setUserStatusAction } from "@/features/users/actions";
import { publicStorageUrl } from "@/lib/storage";
import { formatDate } from "@/lib/utils";
import type { ActionResult } from "@/lib/actions";

export type UserRow = {
  id: string;
  full_name: string;
  email: string;
  avatar_path: string | null;
  status: string;
  is_super_admin: boolean;
  created_at: string;
  roles: string[];
  /** Invited but has not accepted yet (Super Admin view only). */
  invite_pending?: boolean;
};

function RowActions({ user, isSuperAdmin, selfId }: { user: UserRow; isSuperAdmin: boolean; selfId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!isSuperAdmin || user.id === selfId) return null;
  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message ?? "Updated");
      router.refresh();
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.email}`} disabled={pending}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {user.invite_pending ? (
          <>
            <DropdownMenuItem onSelect={() => run(() => resendInvitationAction(user.id))}><Send /> Resend invitation</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        {user.status === "active" ? (
          <DropdownMenuItem variant="destructive" onSelect={() => run(() => setUserStatusAction(user.id, "suspended"))}><UserX /> Suspend account</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => run(() => setUserStatusAction(user.id, "active"))}><UserCheck /> Reactivate account</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UsersTable({ rows, isSuperAdmin, selfId }: { rows: UserRow[]; isSuperAdmin: boolean; selfId: string }) {
  const columns: ColumnDef<UserRow, unknown>[] = [
    {
      accessorKey: "full_name",
      header: "Name",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={row.original.full_name || row.original.email} src={publicStorageUrl("avatars", row.original.avatar_path)} />
          <div className="min-w-0">
            {isSuperAdmin ? (
              <Link href={`/users/${row.original.id}`} className="block truncate font-medium hover:underline">{row.original.full_name || "—"}</Link>
            ) : (
              <p className="truncate font-medium">{row.original.full_name || "—"}</p>
            )}
            <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
          </div>
          {row.original.is_super_admin ? <Badge variant="lime">Super Admin</Badge> : null}
        </div>
      ),
    },
    { accessorKey: "email", header: "Email" },
    {
      id: "roles",
      header: "Assignments",
      accessorFn: (r) => r.roles.join(", "),
      cell: ({ row }) => (
        <div className="flex max-w-md flex-wrap gap-1">
          {row.original.roles.length === 0 ? <span className="text-muted-foreground">—</span> : row.original.roles.slice(0, 4).map((r) => <Badge key={r} variant="muted">{r}</Badge>)}
          {row.original.roles.length > 4 ? <Badge variant="outline">+{row.original.roles.length - 4}</Badge> : null}
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: "equals",
      cell: ({ row, getValue }) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={getValue<string>()} />
          {row.original.invite_pending ? <Badge variant="outline">Invite pending</Badge> : null}
        </div>
      ),
    },
    { accessorKey: "created_at", header: "Joined", cell: ({ getValue }) => formatDate(getValue<string>()) },
    { id: "actions", header: "", enableHiding: false, enableSorting: false, cell: ({ row }) => <RowActions user={row.original} isSuperAdmin={isSuperAdmin} selfId={selfId} /> },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search by name or email…"
      filters={[{ columnId: "status", title: "Statuses", options: [{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }] }]}
      exportConfig={{
        filename: "users",
        columns: [
          { key: "full_name", header: "Name" }, { key: "email", header: "Email" }, { key: "status", header: "Status" },
          { key: "super_admin", header: "Super Admin" }, { key: "roles", header: "Assignments" }, { key: "created_at", header: "Joined" },
        ],
        map: (r) => ({ ...r, super_admin: r.is_super_admin ? "yes" : "no", roles: r.roles.join("; ") }),
      }}
      emptyTitle="No users"
    />
  );
}

type InviteForm = { full_name: string; email: string; assignment: "none" | "college_admin" | "event_admin"; target_id: string };

export function InviteUserDialog({
  isSuperAdmin, colleges, events,
}: { isSuperAdmin: boolean; colleges: { id: string; name: string }[]; events: { id: string; name: string; college: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<InviteForm>({
    defaultValues: { full_name: "", email: "", assignment: isSuperAdmin ? "none" : colleges.length ? "college_admin" : "event_admin", target_id: "" },
  });
  const assignment = form.watch("assignment");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await inviteUserAction(values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return void toast.error(result.error);
      }
      setErrors({});
      toast.success(result.message ?? "Done");
      form.reset();
      setOpen(false);
      router.refresh();
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><UserPlus /> Invite user</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>New users receive an email to set their password. Existing users are assigned immediately.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormField id="u-name" label="Full name" error={errors.full_name?.[0]} required>
            <Input id="u-name" {...form.register("full_name")} />
          </FormField>
          <FormField id="u-email" label="Email" error={errors.email?.[0]} required>
            <Input id="u-email" type="email" {...form.register("email")} />
          </FormField>
          <FormField id="u-assignment" label="Assign as">
            <NativeSelect id="u-assignment" {...form.register("assignment", { onChange: () => form.setValue("target_id", "") })}>
              {isSuperAdmin ? <option value="none">No assignment (account only)</option> : null}
              {colleges.length ? <option value="college_admin">College Admin</option> : null}
              {events.length ? <option value="event_admin">Event Admin</option> : null}
            </NativeSelect>
          </FormField>
          {assignment === "college_admin" ? (
            <FormField id="u-college" label="College" error={errors.target_id?.[0]} required>
              <NativeSelect id="u-college" {...form.register("target_id")}>
                <option value="">Select a college…</option>
                {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </FormField>
          ) : null}
          {assignment === "event_admin" ? (
            <FormField id="u-event" label="Event" error={errors.target_id?.[0]} required>
              <NativeSelect id="u-event" {...form.register("target_id")}>
                <option value="">Select an event…</option>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.college}</option>)}
              </NativeSelect>
            </FormField>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Send</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
