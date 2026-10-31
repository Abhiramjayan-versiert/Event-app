"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Permanent delete behind a "type the name to confirm" dialog. */
export function TypedDeleteDialog({
  label, title, description, name, onDelete, redirectTo, size = "default",
}: {
  label: string;
  title: string;
  description: React.ReactNode;
  /** The exact name the user must type. */
  name: string;
  onDelete: (typed: string) => Promise<ActionResult>;
  redirectTo: string;
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
      <DialogTrigger asChild>
        <Button variant="destructive" size={size}><Trash2 /> {label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild><div className="space-y-2">{description}</div></DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!matches) return;
            start(async () => {
              const r = await onDelete(typed);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message ?? "Deleted");
              setOpen(false);
              router.push(redirectTo);
              router.refresh();
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="typed-delete">Type <span className="font-semibold">{name}</span> to confirm</Label>
            <Input id="typed-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={!matches} loading={pending}>Delete permanently</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
