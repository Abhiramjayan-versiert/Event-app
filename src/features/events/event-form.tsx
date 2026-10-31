"use client";

import { useRouter } from "next/navigation";
import { useLocalDateTimeFields } from "@/lib/use-local-datetime";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FormField } from "@/components/shared/form-field";
import {
  CURRENCIES, EVENT_CATEGORIES, EVENT_STATUSES, SOCIAL_PLATFORMS, eventSchema, type EventInput,
} from "@/lib/validations/event";
import { createEventAction, updateEventAction } from "@/features/events/actions";
import { titleCase } from "@/lib/utils";

const SOCIAL_LABELS: Record<(typeof SOCIAL_PLATFORMS)[number], string> = {
  instagram: "Instagram", linkedin: "LinkedIn", x: "X (Twitter)", youtube: "YouTube", facebook: "Facebook",
};


export function EventForm({
  colleges, eventId, defaults,
}: {
  colleges: { id: string; name: string }[];
  eventId?: string;
  defaults?: Partial<EventInput>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [withAdmin, setWithAdmin] = useState(false);
  const [admin, setAdmin] = useState({ full_name: "", email: "" });
  const form = useForm<EventInput>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      college_id: colleges.length === 1 ? colleges[0].id : "",
      name: "", slug: "", category: "cultural", description: "", starts_on: "", ends_on: "",
      registration_opens_at: "", registration_closes_at: "", venue: "", website_url: "", contact_email: "",
      contact_phone: "", currency: "INR", status: "planning",
      social_links: { instagram: "", linkedin: "", x: "", youtube: "", facebook: "" },
      ...defaults,
    },
  });
  useLocalDateTimeFields(form, ["registration_opens_at", "registration_closes_at"]);
  const { errors } = form.formState;
  const field = (name: Exclude<keyof EventInput, "social_links">) => ({ id: name, "aria-invalid": !!errors[name], ...form.register(name) });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const offset = new Date().getTimezoneOffset();
      const result = eventId
        ? await updateEventAction(eventId, values, offset)
        : await createEventAction(values, offset, withAdmin ? admin : undefined);
      if (!result.ok) {
        for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(key as keyof EventInput, { message: messages?.[0] });
        }
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      const id = eventId ?? (result.data as { id: string } | undefined)?.id;
      router.push(id ? (eventId ? `/events/${id}/settings` : `/events/${id}`) : "/events");
      router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-10" noValidate>
      <Section title="Basics">
        <FormField id="college_id" label="College" error={errors.college_id?.message} required>
          <NativeSelect {...field("college_id")} disabled={Boolean(eventId)}>
            <option value="">Select a college…</option>
            {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id="category" label="Category" error={errors.category?.message} required>
          <NativeSelect {...field("category")}>
            {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id="name" label="Event name" error={errors.name?.message} required className="md:col-span-2">
          <Input {...field("name")} placeholder="e.g. Spectrum 2027" />
        </FormField>
        <FormField id="slug" label="URL slug" error={errors.slug?.message} hint="Optional. Generated from the name if left empty.">
          <Input {...field("slug")} placeholder="spectrum-2027" />
        </FormField>
        <FormField id="status" label="Status" error={errors.status?.message}>
          <NativeSelect {...field("status")}>
            {EVENT_STATUSES.filter((s) => s !== "archived").map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id="description" label="Description" error={errors.description?.message} className="md:col-span-2">
          <Textarea rows={4} {...field("description")} />
        </FormField>
      </Section>

      <Section title="Dates">
        <FormField id="starts_on" label="Event start date" error={errors.starts_on?.message} required>
          <Input type="date" {...field("starts_on")} />
        </FormField>
        <FormField id="ends_on" label="Event end date" error={errors.ends_on?.message} required>
          <Input type="date" {...field("ends_on")} />
        </FormField>
        <FormField id="registration_opens_at" label="Registration opens" error={errors.registration_opens_at?.message}>
          <Input type="datetime-local" {...field("registration_opens_at")} />
        </FormField>
        <FormField id="registration_closes_at" label="Registration closes" error={errors.registration_closes_at?.message}>
          <Input type="datetime-local" {...field("registration_closes_at")} />
        </FormField>
      </Section>

      <Section title="Venue & contact">
        <FormField id="venue" label="Venue" error={errors.venue?.message} className="md:col-span-2">
          <Input {...field("venue")} />
        </FormField>
        <FormField id="website_url" label="Event website URL" error={errors.website_url?.message} hint="The public website that will send registrations. You can change it later.">
          <Input type="url" placeholder="https://" {...field("website_url")} />
        </FormField>
        <FormField id="currency" label="Currency" error={errors.currency?.message}>
          <NativeSelect {...field("currency")}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id="contact_email" label="Contact email" error={errors.contact_email?.message}>
          <Input type="email" {...field("contact_email")} />
        </FormField>
        <FormField id="contact_phone" label="Contact number" error={errors.contact_phone?.message}>
          <Input type="tel" {...field("contact_phone")} />
        </FormField>
      </Section>

      <Section title="Social media">
        {SOCIAL_PLATFORMS.map((p) => (
          <FormField key={p} id={`social_${p}`} label={SOCIAL_LABELS[p]} error={errors.social_links?.[p]?.message}>
            <Input id={`social_${p}`} type="url" placeholder="https://" {...form.register(`social_links.${p}`)} />
          </FormField>
        ))}
      </Section>

      {!eventId ? (
        <section className="space-y-4 rounded-lg border p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Event administrator</h2>
              <p className="text-sm text-muted-foreground">Optionally appoint the person who will run this event. New users receive an invitation.</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="with-admin" checked={withAdmin} onCheckedChange={setWithAdmin} />
              <Label htmlFor="with-admin" className="sr-only">Appoint an event administrator</Label>
            </div>
          </div>
          {withAdmin ? (
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="admin_name" label="Full name" required>
                <Input id="admin_name" value={admin.full_name} onChange={(e) => setAdmin((a) => ({ ...a, full_name: e.target.value }))} />
              </FormField>
              <FormField id="admin_email" label="Email" required>
                <Input id="admin_email" type="email" value={admin.email} onChange={(e) => setAdmin((a) => ({ ...a, email: e.target.value }))} />
              </FormField>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>{eventId ? "Save changes" : "Create event"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}
