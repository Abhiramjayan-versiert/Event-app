"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, titleCase } from "@/lib/utils";

export type AuditRow = {
  id: number;
  occurred_at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  event: string;
  changes: string;
};

const columns: ColumnDef<AuditRow, unknown>[] = [
  { accessorKey: "occurred_at", header: "When", cell: ({ getValue }) => <span className="tabular text-xs">{formatDateTime(getValue<string>())}</span> },
  { accessorKey: "actor", header: "Actor" },
  { accessorKey: "action", header: "Action", filterFn: "equals", cell: ({ getValue }) => <Badge variant={getValue<string>() === "delete" ? "destructive" : getValue<string>() === "insert" ? "success" : "muted"}>{getValue<string>()}</Badge> },
  { accessorKey: "entity_type", header: "Record", filterFn: "equals", cell: ({ getValue }) => titleCase(getValue<string>()) },
  { accessorKey: "event", header: "Event" },
  { accessorKey: "changes", header: "Changed fields", cell: ({ getValue }) => <span className="block max-w-xs truncate font-mono text-xs text-muted-foreground" title={getValue<string>()}>{getValue<string>()}</span> },
];

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const entities = [...new Set(rows.map((r) => r.entity_type))].sort();
  return (
    <DataTable
      columns={columns}
      data={rows}
      pageSize={50}
      searchPlaceholder="Search actor, record or event…"
      filters={[
        { columnId: "action", title: "Actions", options: ["insert", "update", "delete"].map((a) => ({ value: a, label: titleCase(a) })) },
        { columnId: "entity_type", title: "Records", options: entities.map((e) => ({ value: e, label: titleCase(e) })) },
      ]}
      exportConfig={{
        filename: "audit-log",
        columns: [
          { key: "occurred_at", header: "Occurred at" }, { key: "actor", header: "Actor" }, { key: "action", header: "Action" },
          { key: "entity_type", header: "Record type" }, { key: "entity_id", header: "Record id" }, { key: "event", header: "Event" }, { key: "changes", header: "Changed fields" },
        ],
      }}
      emptyTitle="No audit entries"
    />
  );
}

export type ActivityRow = {
  id: string;
  created_at: string;
  actor: string;
  activity_type: string;
  summary: string;
  college: string;
  event: string;
  department: string;
};

const activityColumns: ColumnDef<ActivityRow, unknown>[] = [
  { accessorKey: "created_at", header: "When", cell: ({ getValue }) => <span className="tabular text-xs">{formatDateTime(getValue<string>())}</span> },
  { accessorKey: "actor", header: "Who" },
  { accessorKey: "summary", header: "What happened", cell: ({ getValue }) => <span className="block max-w-md truncate" title={getValue<string>()}>{getValue<string>()}</span> },
  { accessorKey: "activity_type", header: "Type", filterFn: "equals", cell: ({ getValue }) => <Badge variant="muted">{getValue<string>()}</Badge> },
  { accessorKey: "college", header: "College", filterFn: "equals" },
  { accessorKey: "event", header: "Event", filterFn: "equals" },
  { accessorKey: "department", header: "Department" },
];

export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  const distinct = (key: "activity_type" | "college" | "event") => [...new Set(rows.map((r) => r[key]).filter((v) => v && v !== "—"))].sort();
  return (
    <DataTable
      columns={activityColumns}
      data={rows}
      pageSize={50}
      searchPlaceholder="Search people, events or actions…"
      filters={[
        { columnId: "activity_type", title: "Types", options: distinct("activity_type").map((v) => ({ value: v, label: v })) },
        { columnId: "college", title: "Colleges", options: distinct("college").map((v) => ({ value: v, label: v })) },
        { columnId: "event", title: "Events", options: distinct("event").map((v) => ({ value: v, label: v })) },
      ]}
      exportConfig={{
        filename: "activity-log",
        columns: [
          { key: "created_at", header: "When" }, { key: "actor", header: "Who" }, { key: "summary", header: "What happened" },
          { key: "activity_type", header: "Type" }, { key: "college", header: "College" }, { key: "event", header: "Event" }, { key: "department", header: "Department" },
        ],
      }}
      emptyTitle="No activity yet"
    />
  );
}
