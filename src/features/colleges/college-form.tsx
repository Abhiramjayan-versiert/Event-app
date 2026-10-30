"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/shared/form-field";
import { collegeSchema, type CollegeInput } from "@/lib/validations/college";
import { createCollegeAction, updateCollegeAction } from "@/features/colleges/actions";

export function CollegeForm({ collegeId, defaults }: { collegeId?: string; defaults?: Partial<CollegeInput> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<CollegeInput>({
    resolver: zodResolver(collegeSchema),
    defaultValues: {
      name: "", code: "", email: "", website: "", phone: "", address: "", city: "", state: "", country: "India",
      description: "", status: "active", ...defaults,
    },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = collegeId ? await updateCollegeAction(collegeId, values) : await createCollegeAction(values);
      if (!result.ok) {
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as keyof CollegeInput, { message: messages?.[0] });
        }
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      const id = collegeId ?? (result.data as { id: string } | undefined)?.id;
      router.push(id ? `/colleges/${id}` : "/colleges");
      router.refresh();
    }),
  );

  const field = (name: keyof CollegeInput) => ({ id: name, "aria-invalid": !!errors[name], ...form.register(name) });

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <section className="grid gap-4 md:grid-cols-2">
        <FormField id="name" label="College name" error={errors.name?.message} required className="md:col-span-2">
          <Input {...field("name")} placeholder="e.g. St. Xavier's College" />
        </FormField>
        <FormField id="code" label="College code" error={errors.code?.message} hint="Short unique identifier, e.g. SXC" required>
          <Input {...field("code")} className="uppercase" />
        </FormField>
        <FormField id="status" label="Status" error={errors.status?.message}>
          <NativeSelect {...field("status")}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </NativeSelect>
        </FormField>
        <FormField id="email" label="College email" error={errors.email?.message}>
          <Input type="email" {...field("email")} />
        </FormField>
        <FormField id="phone" label="Contact number" error={errors.phone?.message}>
          <Input type="tel" {...field("phone")} />
        </FormField>
        <FormField id="website" label="Website" error={errors.website?.message} className="md:col-span-2">
          <Input type="url" placeholder="https://" {...field("website")} />
        </FormField>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <FormField id="address" label="Address" error={errors.address?.message} className="md:col-span-3">
          <Input {...field("address")} />
        </FormField>
        <FormField id="city" label="City" error={errors.city?.message}>
          <Input {...field("city")} />
        </FormField>
        <FormField id="state" label="State" error={errors.state?.message}>
          <Input {...field("state")} />
        </FormField>
        <FormField id="country" label="Country" error={errors.country?.message} required>
          <Input {...field("country")} />
        </FormField>
      </section>
      <FormField id="description" label="Description" error={errors.description?.message}>
        <Textarea rows={4} {...field("description")} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>{collegeId ? "Save changes" : "Create college"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
