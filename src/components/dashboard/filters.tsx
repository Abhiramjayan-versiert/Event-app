"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type FilterDef =
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[] }
  | { type: "date"; name: string; label: string };

/** URL-driven filter bar: every change updates the query string, so filters are shareable and server-rendered. */
export function FilterBar({ filters }: { filters: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const active = filters.some((f) => params.get(f.name));

  return (
    <div className="flex flex-wrap items-end gap-2" aria-busy={pending}>
      {filters.map((f) =>
        f.type === "select" ? (
          <label key={f.name} className="grid gap-1 text-xs text-muted-foreground">
            {f.label}
            <NativeSelect className="h-8 min-w-40 text-sm text-foreground" value={params.get(f.name) ?? ""} onChange={(e) => update(f.name, e.target.value)}>
              <option value="">All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </NativeSelect>
          </label>
        ) : (
          <label key={f.name} className="grid gap-1 text-xs text-muted-foreground">
            {f.label}
            <Input type="date" className="h-8 w-40 text-sm text-foreground" value={params.get(f.name) ?? ""} onChange={(e) => update(f.name, e.target.value)} />
          </label>
        ),
      )}
      {active ? (
        <Button variant="ghost" size="sm" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
