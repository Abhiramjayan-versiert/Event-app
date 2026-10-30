"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AccessSummary } from "@/lib/auth/types";

type ShellState = {
  access: AccessSummary;
  crumbs: Record<string, string>;
  setCrumb: (id: string, label: string) => void;
};

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ access, children }: { access: AccessSummary; children: React.ReactNode }) {
  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of access.colleges) map[c.id] = c.name;
    for (const e of access.events) map[e.id] = e.name;
    return map;
  }, [access]);
  const [crumbs, setCrumbs] = useState(initial);
  const setCrumb = useCallback((id: string, label: string) => {
    setCrumbs((prev) => (prev[id] === label ? prev : { ...prev, [id]: label }));
  }, []);
  return <ShellContext.Provider value={{ access, crumbs, setCrumb }}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside ShellProvider");
  return ctx;
}

/** Registers a human-readable breadcrumb label for an id segment in the URL. */
export function Crumb({ id, label }: { id: string; label: string }) {
  const { setCrumb } = useShell();
  useEffect(() => setCrumb(id, label), [id, label, setCrumb]);
  return null;
}
