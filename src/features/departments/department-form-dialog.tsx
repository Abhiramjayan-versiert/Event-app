"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import { DEPARTMENT_ICONS, DEPARTMENT_KINDS, departmentSchema, type DepartmentInput } from "@/lib/validations/department";
import { createDepartmentAction, updateDepartmentAction } from "@/features/departments/actions";
import { DepartmentIcon } from "@/features/departments/department-icon";
import { titleCase } from "@/lib/utils";

export function DepartmentFormDialog({
  eventId, departmentId, defaults, trigger, canEditStructure = true,
}: {
  eventId: string;
  departmentId?: string;
  defaults?: DepartmentInput;
  trigger: React.ReactNode;
  /** Department heads may edit description/progress but not name/kind/status. */
  canEditStructure?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<DepartmentInput>({
    resolver: zodResolver(departmentSchema),
    defaultValues: defaults ?? { name: "", kind: "general", description: "", icon: "layers", status: "active", progress_pct: 0 },
  });
  const { errors } = form.formState;
  const icon = form.watch("icon");

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = departmentId
        ? await updateDepartmentAction(eventId, departmentId, values)
        : await createDepartmentAction(eventId, values);
      if (!result.ok) {
        for (const [k, v] of Object.entries(result.fieldErrors ?? {})) form.setError(k as keyof DepartmentInput, { message: v?.[0] });
        return void toast.error(result.error);
      }
      toast.success(result.message ?? "Saved");
      setOpen(false);
      if (!departmentId) form.reset();
      const id = departmentId ?? (result.data as { id: string } | undefined)?.id;
      router.push(id ? `/events/${eventId}/departments/${id}` : `/events/${eventId}/departments`);
      router.refresh();
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{departmentId ? "Edit department" : "New department"}</DialogTitle>
          <DialogDescription>
            The department type decides which head role is suggested (e.g. Finance → Finance Head).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="d-name" label="Name" error={errors.name?.message} required className="sm:col-span-2">
            <Input id="d-name" disabled={!canEditStructure} {...form.register("name")} />
          </FormField>
          <FormField id="d-kind" label="Type">
            <NativeSelect id="d-kind" disabled={!canEditStructure} {...form.register("kind")}>
              {DEPARTMENT_KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="d-status" label="Status">
            <NativeSelect id="d-status" disabled={!canEditStructure} {...form.register("status")}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </NativeSelect>
          </FormField>
          <FormField id="d-icon" label="Icon">
            <div className="flex items-center gap-2">
              <DepartmentIcon icon={icon} />
              <NativeSelect id="d-icon" className="flex-1" {...form.register("icon")}>
                {DEPARTMENT_ICONS.map((i) => <option key={i} value={i}>{titleCase(i)}</option>)}
              </NativeSelect>
            </div>
          </FormField>
          <FormField id="d-progress" label="Progress (%)" error={errors.progress_pct?.message}>
            <Input id="d-progress" type="number" min={0} max={100} {...form.register("progress_pct", { valueAsNumber: true })} />
          </FormField>
          <FormField id="d-desc" label="Description" error={errors.description?.message} className="sm:col-span-2">
            <Textarea id="d-desc" rows={3} {...form.register("description")} />
          </FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>{departmentId ? "Save" : "Create department"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
