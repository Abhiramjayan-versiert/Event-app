"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateRange, titleCase } from "@/lib/utils";
import { EVENT_STATUSES } from "@/lib/validations/event";

export type EventRow = {
  id: string;
  name: string;
  college: string;
  category: string;
  status: string;
  starts_on: string;
  ends_on: string;
  venue: string | null;
};

const columns: ColumnDef<EventRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Event",
    enableHiding: false,
    cell: ({ row }) => (
      <Link href={`/events/${row.original.id}`} className="font-medium hover:underline">{row.original.name}</Link>
    ),
  },
  { accessorKey: "college", header: "College", filterFn: "equals" },
  { accessorKey: "category", header: "Category", cell: ({ getValue }) => titleCase(getValue<string>()) },
  { id: "dates", header: "Dates", accessorFn: (r) => r.starts_on, cell: ({ row }) => formatDateRange(row.original.starts_on, row.original.ends_on) },
  { accessorKey: "venue", header: "Venue", cell: ({ getValue }) => getValue<string | null>() ?? "—" },
  { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
];

export function EventsTable({ rows, canCreate }: { rows: EventRow[]; canCreate: boolean }) {
  const colleges = [...new Set(rows.map((r) => r.college))].sort();
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search events…"
      filters={[
        { columnId: "status", title: "Statuses", options: EVENT_STATUSES.map((s) => ({ value: s, label: titleCase(s) })) },
        ...(colleges.length > 1 ? [{ columnId: "college", title: "Colleges", options: colleges.map((c) => ({ value: c, label: c })) }] : []),
      ]}
      exportConfig={{
        filename: "events",
        columns: [
          { key: "name", header: "Event" }, { key: "college", header: "College" }, { key: "category", header: "Category" },
          { key: "starts_on", header: "Starts" }, { key: "ends_on", header: "Ends" }, { key: "venue", header: "Venue" }, { key: "status", header: "Status" },
        ],
      }}
      emptyTitle="No events yet"
      emptyDescription={canCreate ? "Create an event to generate its workspace." : "You have not been assigned to any events."}
      emptyAction={canCreate ? <Link href="/events/new" className="text-sm font-medium underline underline-offset-4">Create an event</Link> : undefined}
    />
  );
}
