"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/utils";

export type CollegeRow = {
  id: string;
  name: string;
  code: string;
  city: string | null;
  state: string | null;
  status: string;
  email: string | null;
  events: number;
  created_at: string;
};

const columns: ColumnDef<CollegeRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "College",
    enableHiding: false,
    cell: ({ row }) => (
      <Link href={`/colleges/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  { accessorKey: "code", header: "Code", cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span> },
  { id: "location", header: "Location", accessorFn: (r) => [r.city, r.state].filter(Boolean).join(", ") || "—" },
  { accessorKey: "events", header: "Events", cell: ({ getValue }) => <span className="tabular">{getValue<number>()}</span> },
  { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
  { accessorKey: "created_at", header: "Created", cell: ({ getValue }) => formatDate(getValue<string>()) },
];

export function CollegesTable({ rows, canCreate }: { rows: CollegeRow[]; canCreate: boolean }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search by name, code or city…"
      filters={[{ columnId: "status", title: "Statuses", options: [{ label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }, { label: "Archived", value: "archived" }] }]}
      exportConfig={{
        filename: "colleges",
        columns: [
          { key: "name", header: "Name" }, { key: "code", header: "Code" }, { key: "city", header: "City" }, { key: "state", header: "State" },
          { key: "email", header: "Email" }, { key: "events", header: "Events" }, { key: "status", header: "Status" }, { key: "created_at", header: "Created" },
        ],
      }}
      emptyTitle="No colleges yet"
      emptyDescription={canCreate ? "Create the first college to start organising its events." : "You have not been assigned to a college."}
      emptyAction={canCreate ? <Link href="/colleges/new" className="text-sm font-medium underline underline-offset-4">Create a college</Link> : undefined}
    />
  );
}
