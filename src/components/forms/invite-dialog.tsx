"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import { inviteSchema, type InviteInput } from "@/lib/validations/user";
import type { ActionResult } from "@/lib/actions";

/** Name + email dialog that adds an existing user or invites a new one. */
export function InviteDialog({
  trigger, title, description, submitLabel = "Add", onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  submitLabel?: string;
  onSubmit: (values: InviteInput) => Promise<ActionResult<unknown>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<InviteInput>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", full_name: "" } });

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await onSubmit(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Done");
      form.reset();
      setOpen(false);
      router.refresh();
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormField id="invite-name" label="Full name" error={form.formState.errors.full_name?.message} required>
            <Input id="invite-name" autoFocus {...form.register("full_name")} />
          </FormField>
          <FormField id="invite-email" label="Email" error={form.formState.errors.email?.message} hint="New users receive an invitation email to set their password." required>
            <Input id="invite-email" type="email" {...form.register("email")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
