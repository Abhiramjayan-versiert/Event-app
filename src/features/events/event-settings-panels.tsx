"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Archive, ArchiveRestore, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/ui/avatar";
import { FormField } from "@/components/shared/form-field";
import { BrandingUploader } from "@/components/forms/branding-uploader";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { InviteDialog } from "@/components/forms/invite-dialog";
import {
  addEventAdminAction, changeEventRoleAction, endEventMembershipAction, setEventImageAction, setEventStatusAction, updateRegistrationSettingsAction,
} from "@/features/events/actions";
import { EVENT_STATUSES, registrationSettingsSchema, type RegistrationSettingsInput } from "@/lib/validations/event";
import { publicStorageUrl } from "@/lib/storage";
import { formatDate, titleCase } from "@/lib/utils";

export function EventBranding({ eventId, logoPath, bannerPath }: { eventId: string; logoPath: string | null; bannerPath: string | null }) {
  return (
    <div className="space-y-5">
      <BrandingUploader folder={`events/${eventId}`} currentPath={logoPath} label="Logo" onSaved={(p) => setEventImageAction(eventId, "logo_path", p)} />
      <BrandingUploader folder={`events/${eventId}`} currentPath={bannerPath} label="Banner" aspect="banner" onSaved={(p) => setEventImageAction(eventId, "banner_path", p)} />
    </div>
  );
}

export function RegistrationSettingsForm({ eventId, defaults, publicUrl }: { eventId: string; defaults: RegistrationSettingsInput; publicUrl?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<RegistrationSettingsInput>({ resolver: zodResolver(registrationSettingsSchema), defaultValues: defaults });
  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await updateRegistrationSettingsAction(eventId, values);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message ?? "Saved");
      router.refresh();
    }),
  );
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField id="duplicate_rule" label="Duplicate prevention" hint="Registrations matching an existing active registration under this rule are rejected.">
        <NativeSelect id="duplicate_rule" {...form.register("duplicate_rule")}>
          <option value="email_per_category">One registration per email per category</option>
          <option value="email_per_event">One registration per email per event</option>
          <option value="phone_per_category">One registration per phone per category</option>
          <option value="none">Allow duplicates</option>
        </NativeSelect>
      </FormField>
      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <Label htmlFor="allow_team_registrations">Allow team registrations</Label>
        <Controller
          control={form.control}
          name="allow_team_registrations"
          render={({ field }) => <Switch id="allow_team_registrations" checked={field.value} onCheckedChange={field.onChange} />}
        />
      </div>
      <FormField id="max_team_size" label="Maximum team size" error={form.formState.errors.max_team_size?.message}>
        <Input id="max_team_size" type="number" min={1} max={50} className="w-32" {...form.register("max_team_size", { valueAsNumber: true })} />
      </FormField>
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="public_page_enabled">Public registration page</Label>
          <Controller
            control={form.control}
            name="public_page_enabled"
            render={({ field }) => <Switch id="public_page_enabled" checked={field.value} onCheckedChange={field.onChange} />}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Lets anyone register on this app's own event page and get a QR ticket. No college website needed.
        </p>
        {publicUrl ? (
          <a href={publicUrl} target="_blank" rel="noreferrer" className="block break-all text-xs font-medium underline underline-offset-4">{publicUrl}</a>
        ) : null}
      </div>
      <Button type="submit" loading={pending}>Save registration settings</Button>
    </form>
  );
}

export type EventAdminRow = { membershipId: string; name: string; email: string; avatarPath: string | null; since: string };

export function EventAdmins({
  eventId, admins, canManage, roles = [],
}: { eventId: string; admins: EventAdminRow[]; canManage: boolean; roles?: { key: string; name: string }[] }) {
  const router = useRouter();
  const [changing, startChange] = useTransition();
  return (
    <div className="space-y-3">
      {admins.length === 0 ? (
        <p className="text-sm text-muted-foreground">No event administrators appointed yet.</p>
      ) : (
        <ul className="divide-y">
          {admins.map((a) => (
            <li key={a.membershipId} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar name={a.name} src={publicStorageUrl("avatars", a.avatarPath)} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.name || a.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.email} · since {formatDate(a.since)}</p>
                </div>
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                {roles.length > 1 ? (
                  <NativeSelect
                    aria-label={`Change role of ${a.name || a.email}`}
                    className="h-8 w-36 text-xs"
                    value="event_admin"
                    disabled={changing}
                    onChange={(e) => {
                      const key = e.target.value;
                      startChange(async () => {
                        const r = await changeEventRoleAction(eventId, a.membershipId, key);
                        if (!r.ok) return void toast.error(r.error);
                        toast.success(r.message ?? "Role changed");
                        router.refresh();
                      });
                    }}
                  >
                    {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                  </NativeSelect>
                ) : null}
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  destructive
                  title="Remove event administrator?"
                  description={`${a.name || a.email} will lose Event Admin access. The assignment stays in the history.`}
                  confirmLabel="Remove"
                  action={() => endEventMembershipAction(eventId, a.membershipId, "Removed as event admin")}
                >
                  <UserMinus /> Remove
                </ConfirmButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <InviteDialog
          trigger={<Button variant="outline" size="sm"><UserPlus /> Appoint event admin</Button>}
          title="Appoint event administrator"
          description="Event admins manage this event end to end: departments, team, finance and operations."
          submitLabel="Appoint"
          onSubmit={(values) => addEventAdminAction(eventId, values)}
        />
      ) : null}
    </div>
  );
}

export function EventLifecycle({ eventId, status }: { eventId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const archived = status === "archived";
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <FormField id="quick-status" label="Event status" hint="Updates immediately for everyone in the event.">
        <NativeSelect
          id="quick-status"
          value={status}
          disabled={pending || archived}
          className="w-56"
          onChange={(e) =>
            startTransition(async () => {
              const result = await setEventStatusAction(eventId, e.target.value);
              if (!result.ok) return void toast.error(result.error);
              toast.success(result.message ?? "Status updated");
              router.refresh();
            })
          }
        >
          {EVENT_STATUSES.filter((s) => s !== "archived" || archived).map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </NativeSelect>
      </FormField>
      <ConfirmButton
        variant="outline"
        title={archived ? "Restore this event?" : "Archive this event?"}
        description={
          archived
            ? "The event returns to Completed status and becomes editable again."
            : "Archived events are kept for reporting and audit. Nothing is deleted, and you can restore it later."
        }
        confirmLabel={archived ? "Restore" : "Archive"}
        action={() => setEventStatusAction(eventId, archived ? "completed" : "archived")}
      >
        {archived ? <><ArchiveRestore /> Restore event</> : <><Archive /> Archive event</>}
      </ConfirmButton>
    </div>
  );
}
