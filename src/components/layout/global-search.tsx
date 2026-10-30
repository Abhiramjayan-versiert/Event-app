"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, CalendarDays, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Result = { colleges: { id: string; name: string; code: string }[]; events: { id: string; name: string; status: string }[] };

/** ⌘K / Ctrl+K search across colleges and events the user can access (RLS enforced). */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result>({ colleges: [], events: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults({ colleges: [], events: [] });
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      const supabase = createClient();
      const pattern = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const [colleges, events] = await Promise.all([
        supabase.from("colleges").select("id, name, code").or(`name.ilike.${pattern},code.ilike.${pattern}`).limit(5),
        supabase.from("events").select("id, name, status").ilike("name", pattern).limit(8),
      ]);
      setResults({ colleges: colleges.data ?? [], events: events.data ?? [] });
      setLoading(false);
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <Button variant="outline" className="h-9 w-9 justify-start gap-2 px-0 text-muted-foreground sm:w-56 sm:px-3" onClick={() => setOpen(true)} aria-label="Search">
        <Search className="mx-auto size-4 sm:mx-0" />
        <span className="hidden flex-1 text-left font-normal sm:inline">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search colleges and events…" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>{query.trim().length < 2 ? "Type at least 2 characters." : loading ? "Searching…" : "No results."}</CommandEmpty>
              {results.colleges.length > 0 ? (
                <CommandGroup heading="Colleges">
                  {results.colleges.map((c) => (
                    <CommandItem key={c.id} value={`college-${c.id}`} onSelect={() => go(`/colleges/${c.id}`)}>
                      <Building2 />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {results.events.length > 0 ? (
                <CommandGroup heading="Events">
                  {results.events.map((e) => (
                    <CommandItem key={e.id} value={`event-${e.id}`} onSelect={() => go(`/events/${e.id}`)}>
                      <CalendarDays />
                      <span className="flex-1 truncate">{e.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
