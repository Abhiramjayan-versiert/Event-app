"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { RECORDS, type Field, type RecordKind } from "@/lib/records/config";
import { deleteRecordAction, saveRecordAction } from "@/features/records/actions";

export type OptionSets = Partial<Record<NonNullable<Field["optionsKey"]>, { value: string; label: string }[]>>;

function toFormValue(field: Field, value: unknown) {
  if (value === null || value === undefined) return field.type === "switch" ? false : "";
  if (field.type === "datetime" && typeof value === "string") return format(new Date(value), "yyyy-MM-dd'T'HH:mm");
  return value;
}

export function RecordDialog({
  kind, eventId, id, defaults, options = {}, trigger, title,
}: {
  kind: RecordKind;
  eventId: string;
  id?: string;
  defaults?: Record<string, unknown>;
  options?: OptionSets;
  trigger: React.ReactNode;
  title?: string;
}) {
  const def = RECORDS[kind];
  const fields = def.fields as Field[];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const initial = Object.fromEntries(fields.map((f) => [f.name, toFormValue(f, defaults?.[f.name] ?? (f.type === "select" && f.options ? f.options[0]?.value : undefined))]));
  const form = useForm<Record<string, unknown>>({ defaultValues: initial });

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const clean: Record<string, unknown> = {};
      for (const f of fields) {
        const v = values[f.name];
        clean[f.name] = f.type === "number" ? (v === "" || v === null || v === undefined ? null : Number(v)) : v;
      }
      const r = await saveRecordAction(kind, eventId, id ?? null, clean, new Date().getTimezoneOffset());
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      toast.success(r.message ?? "Saved");
      setOpen(false);
      if (!id) form.reset(initial);
      router.refresh();
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{title ?? `${id ? "Edit" : "New"} ${def.title.toLowerCase()}`}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          {fields.map((f) => {
            const fid = `${kind}-${f.name}`;
            const err = errors[f.name]?.[0];
            if (f.type === "switch") {
              return (
                <div key={f.name} className="flex items-center gap-2 sm:col-span-2">
                  <Controller control={form.control} name={f.name} render={({ field }) => <Switch id={fid} checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
                  <Label htmlFor={fid}>{f.label}</Label>
                </div>
              );
            }
            const opts = f.options ?? (f.optionsKey ? options[f.optionsKey] ?? [] : []);
            return (
              <FormField key={f.name} id={fid} label={f.label} required={f.required} error={err} hint={f.hint} className={f.wide || f.type === "textarea" ? "sm:col-span-2" : undefined}>
                {f.type === "textarea" ? (
                  <Textarea id={fid} rows={3} {...form.register(f.name)} />
                ) : f.type === "select" ? (
                  <NativeSelect id={fid} {...form.register(f.name)}>
                    {f.optionsKey ? <option value="">None</option> : null}
                    {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </NativeSelect>
                ) : (
                  <Input
                    id={fid}
                    type={f.type === "datetime" ? "datetime-local" : f.type === "number" ? "number" : f.type}
                    step={f.type === "number" ? "any" : undefined}
                    {...form.register(f.name)}
                  />
                )}
              </FormField>
            );
          })}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRecordButton({ kind, eventId, id, label }: { kind: RecordKind; eventId: string; id: string; label: string }) {
  return (
    <ConfirmButton variant="ghost" size="icon-sm" destructive aria-label={`Delete ${label}`} title={`Delete ${label}?`} description="This cannot be undone." confirmLabel="Delete" action={() => deleteRecordAction(kind, eventId, id)}>
      <Trash2 />
    </ConfirmButton>
  );
}
