"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChevronsUpDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/shared/status-badge";
import { useShell } from "@/components/layout/shell-context";

const EVENT_PATH = /^\/events\/([0-9a-f-]{36})/i;
const COLLEGE_PATH = /^\/colleges\/([0-9a-f-]{36})/i;

/** Shows the current college / event and lets the user jump between their events. */
export function ContextSwitcher() {
  const pathname = usePathname();
  const { access, crumbs } = useShell();
  const eventId = pathname.match(EVENT_PATH)?.[1];
  const collegeId = pathname.match(COLLEGE_PATH)?.[1];
  const current = access.events.find((e) => e.id === eventId);
  const collegeName = current?.college_name ?? (collegeId ? crumbs[collegeId] : undefined);
  const eventName = eventId ? crumbs[eventId] : undefined;

  const byCollege = new Map<string, typeof access.events>();
  for (const e of access.events) byCollege.set(e.college_name, [...(byCollege.get(e.college_name) ?? []), e]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 max-w-[16rem] items-center gap-2 rounded-md border px-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {eventName ? (
            <>
              {collegeName ? <span className="text-muted-foreground">{collegeName} / </span> : null}
              <span className="font-medium">{eventName}</span>
            </>
          ) : collegeName ? (
            <span className="font-medium">{collegeName}</span>
          ) : (
            <span className="text-muted-foreground">Select event</span>
          )}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
        {access.events.length === 0 ? (
          <DropdownMenuLabel className="font-normal">You have no event assignments yet.</DropdownMenuLabel>
        ) : (
          [...byCollege.entries()].map(([college, events]) => (
            <div key={college}>
              <DropdownMenuLabel>{college}</DropdownMenuLabel>
              {events.map((e) => (
                <DropdownMenuItem key={e.id} asChild>
                  <Link href={`/events/${e.id}`} className="flex items-center justify-between gap-2">
                    <span className="truncate">{e.name}</span>
                    <StatusBadge status={e.status} />
                  </Link>
                </DropdownMenuItem>
              ))}
            </div>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/events">View all events</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
