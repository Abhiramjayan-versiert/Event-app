"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { UserMinus, UserPlus } from "lucide-react";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { AssignMemberDialog, type RoleOption } from "@/features/departments/assign-member-dialog";
import { assignEventRoleAction, removeUserFromEventAction } from "@/features/departments/actions";
import { publicStorageUrl } from "@/lib/storage";

export type TeamRow = {
  id: string;
  name: string;
  email: string;
  avatar_path: string | null;
  eventRoles: string[];
  departments: { id: string; label: string; lead: boolean }[];
};

export function TeamTable({
  eventId, rows, canManage, selfId, eventRoles, assignable = [],
}: { eventId: string; rows: TeamRow[]; canManage: boolean; selfId: string; eventRoles: RoleOption[]; assignable?: { id: string; name: string; email: string }[] }) {
  const columns: ColumnDef<TeamRow, unknown>[] = [
    {
      accessorKey: "name",
      header: "Person",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={row.original.name || row.original.email} src={publicStorageUrl("avatars", row.original.avatar_path)} />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name || "—"}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        </div>
      ),
    },
    { accessorKey: "email", header: "Email" },
    {
      id: "event_roles",
      header: "Event role",
      accessorFn: (r) => r.eventRoles.join(", "),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.eventRoles.length ? row.original.eventRoles.map((r) => <Badge key={r} variant="lime">{r}</Badge>) : <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      id: "departments",
      header: "Departments",
      accessorFn: (r) => r.departments.map((d) => d.label).join(", "),
      cell: ({ row }) => (
        <div className="flex max-w-md flex-wrap gap-1">
          {row.original.departments.length ? (
            row.original.departments.map((d) => (
              <Link key={d.id + d.label} href={`/events/${eventId}/departments/${d.id}`}>
                <Badge variant={d.lead ? "default" : "muted"}>{d.label}</Badge>
              </Link>
            ))
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) =>
        canManage && row.original.id !== selfId ? (
          <ConfirmButton
            variant="ghost"
            size="sm"
            destructive
            title={`Remove ${row.original.name || row.original.email} from the event?`}
            description="All their event and department roles end and their open tasks are unassigned. History is kept."
            confirmLabel="Remove"
            action={() => removeUserFromEventAction(eventId, row.original.id)}
          >
            <UserMinus /> Remove
          </ConfirmButton>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search people, roles or departments…"
      exportConfig={{
        filename: "event-team",
        columns: [
          { key: "name", header: "Name" }, { key: "email", header: "Email" },
          { key: "event_roles", header: "Event roles" }, { key: "departments", header: "Departments" },
        ],
        map: (r) => ({ ...r, event_roles: r.eventRoles.join("; "), departments: r.departments.map((d) => d.label).join("; ") }),
      }}
      toolbar={
        canManage ? (
          <AssignMemberDialog
            trigger={<Button size="sm"><UserPlus /> Add person</Button>}
            title="Add to event"
            description="Give an existing user or a new person an event-wide role. Use a department page to assign department positions."
            people={assignable}
            roles={eventRoles}
            submit={(values) => assignEventRoleAction(eventId, values)}
          />
        ) : undefined
      }
      emptyTitle="Nobody is assigned yet"
      emptyDescription="Appoint department heads from the Departments page, or add people with an event role."
    />
  );
}
