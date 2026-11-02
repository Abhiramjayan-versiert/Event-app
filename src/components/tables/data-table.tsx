"use client";

import { useMemo, useState } from "react";
import {
  type ColumnDef, type ColumnFiltersState, type SortingState, type VisibilityState,
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Download, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { downloadCsv, toCsv } from "@/lib/export/csv";
import { cn } from "@/lib/utils";

export type DataTableFilter = { columnId: string; title: string; options: { label: string; value: string }[] };

export type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  searchPlaceholder?: string;
  filters?: DataTableFilter[];
  /** Enables CSV export of the filtered rows. Keys map to row properties. */
  exportConfig?: { filename: string; columns: { key: string; header: string }[]; map?: (row: TData) => Record<string, unknown> };
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  pageSize?: number;
  toolbar?: React.ReactNode;
  onRowClick?: (row: TData) => void;
};

export function DataTable<TData>({
  columns, data, searchPlaceholder = "Search…", filters = [], exportConfig, emptyTitle = "No records yet",
  emptyDescription, emptyAction, pageSize = 20, toolbar, onRowClick,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const filteredRows = table.getFilteredRowModel().rows;
  const hideable = useMemo(() => table.getAllLeafColumns().filter((c) => c.getCanHide()), [table]);

  function exportCsv() {
    if (!exportConfig) return;
    const rows = table.getSortedRowModel().rows.filter((r) => filteredRows.includes(r)).map((r) =>
      exportConfig.map ? exportConfig.map(r.original) : (r.original as Record<string, unknown>),
    );
    downloadCsv(`${exportConfig.filename}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, exportConfig.columns));
  }

  const isFiltered = globalFilter !== "" || columnFilters.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder={searchPlaceholder} className="pl-8" aria-label="Search table" />
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {filters.map((f) => (
            <NativeSelect
              key={f.columnId}
              aria-label={f.title}
              className="h-9 w-auto min-w-36"
              value={(table.getColumn(f.columnId)?.getFilterValue() as string) ?? ""}
              onChange={(e) => table.getColumn(f.columnId)?.setFilterValue(e.target.value || undefined)}
            >
              <option value="">All {f.title.toLowerCase()}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </NativeSelect>
          ))}
          {isFiltered ? (
            <Button variant="ghost" size="sm" onClick={() => { setGlobalFilter(""); setColumnFilters([]); }}>
              Reset
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {toolbar}
          {hideable.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><SlidersHorizontal /> Columns</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                {hideable.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(v) => column.toggleVisibility(!!v)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {exportConfig ? (
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filteredRows.length === 0}>
              <Download /> Export CSV
            </Button>
          ) : null}
        </div>
      </div>

      {data.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <>
        {/* Phones: each row as a card showing every visible column. */}
        <ul className="space-y-2 md:hidden">
          {table.getRowModel().rows.length === 0 ? (
            <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">No records match your filters.</li>
          ) : (
            table.getRowModel().rows.map((row) => {
              const [first, ...rest] = row.getVisibleCells();
              const labelled = rest.filter((c) => typeof c.column.columnDef.header === "string" && c.column.columnDef.header !== "");
              const unlabelled = rest.filter((c) => !(typeof c.column.columnDef.header === "string" && c.column.columnDef.header !== ""));
              return (
                <li
                  key={row.id}
                  className={cn("space-y-2 rounded-lg border bg-card p-4 text-sm", onRowClick && "cursor-pointer active:bg-muted/50")}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {first ? <div className="min-w-0 font-medium [&_*]:max-w-none">{flexRender(first.column.columnDef.cell, first.getContext())}</div> : null}
                  {labelled.length ? (
                    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1.5">
                      {labelled.map((cell) => (
                        <div key={cell.id} className="contents">
                          <dt className="text-xs text-muted-foreground">{cell.column.columnDef.header as string}</dt>
                          <dd className="min-w-0 break-words [&_*]:max-w-none [&_.truncate]:whitespace-normal">{flexRender(cell.column.columnDef.cell, cell.getContext())}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {unlabelled.length ? (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-2" onClick={(e) => e.stopPropagation()}>
                      {unlabelled.map((cell) => <div key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>)}
                    </div>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
        <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((header) => {
                    const sortable = header.column.getCanSort();
                    const dir = header.column.getIsSorted();
                    return (
                      <TableHead key={header.id} aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                        {header.isPlaceholder ? null : sortable ? (
                          <button type="button" className="-ml-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground" onClick={header.column.getToggleSortingHandler()}>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center text-muted-foreground">
                    No records match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className={cn(onRowClick && "cursor-pointer")} onClick={onRowClick ? () => onRowClick(row.original) : undefined}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      {data.length > 0 ? (
        <div className="flex flex-col items-center justify-between gap-2 text-sm text-muted-foreground sm:flex-row">
          <span>
            {filteredRows.length} of {data.length} record{data.length === 1 ? "" : "s"}
          </span>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <NativeSelect aria-label="Rows per page" className="h-8 w-auto" value={table.getState().pagination.pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </NativeSelect>
            <span className="tabular">
              Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
