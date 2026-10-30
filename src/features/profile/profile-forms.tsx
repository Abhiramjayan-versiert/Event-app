"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/avatar";
import { FormField } from "@/components/shared/form-field";
import { profileSchema, setPasswordSchema, type ProfileInput, type SetPasswordInput } from "@/lib/validations/auth";
import { setAvatarPathAction, setPasswordAction, updateProfileAction } from "@/features/auth/actions";
import { createClient } from "@/lib/supabase/client";
import { publicStorageUrl, safeFileName, UPLOAD_LIMITS } from "@/lib/storage";

export function AvatarUploader({ userId, name, avatarPath }: { userId: string; name: string; avatarPath: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    if (!(UPLOAD_LIMITS.avatar.types as readonly string[]).includes(file.type)) return toast.error("Use a PNG, JPG or WebP image.");
    if (file.size > UPLOAD_LIMITS.avatar.maxBytes) return toast.error("Profile pictures must be 2 MB or smaller.");
    setBusy(true);
    const path = `${userId}/${Date.now()}-${safeFileName(file.name)}`;
    const { error } = await createClient().storage.from("avatars").upload(path, file, { contentType: file.type });
    if (error) {
      setBusy(false);
      return toast.error("Upload failed.");
    }
    const result = await setAvatarPathAction(path);
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Profile picture updated");
    router.refresh();
  }
  return (
    <div className="flex items-center gap-4">
      <UserAvatar name={name} src={publicStorageUrl("avatars", avatarPath)} className="size-16 text-lg" />
      <input ref={input} type="file" accept={UPLOAD_LIMITS.avatar.types.join(",")} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      <Button variant="outline" size="sm" loading={busy} onClick={() => input.current?.click()}><Camera /> Change picture</Button>
    </div>
  );
}

export function ProfileForm({ defaults }: { defaults: ProfileInput }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: defaults });
  const { errors } = form.formState;
  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await updateProfileAction(values);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message ?? "Saved");
      router.refresh();
    }),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2" noValidate>
      <FormField id="full_name" label="Full name" error={errors.full_name?.message} required className="md:col-span-2">
        <Input id="full_name" {...form.register("full_name")} />
      </FormField>
      <FormField id="phone" label="Phone" error={errors.phone?.message}>
        <Input id="phone" type="tel" {...form.register("phone")} />
      </FormField>
      <FormField id="job_title" label="Title / designation" error={errors.job_title?.message}>
        <Input id="job_title" {...form.register("job_title")} />
      </FormField>
      <div className="md:col-span-2">
        <Button type="submit" loading={pending}>Save profile</Button>
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition();
  const form = useForm<SetPasswordInput>({ resolver: zodResolver(setPasswordSchema), defaultValues: { password: "", confirmPassword: "" } });
  const { errors } = form.formState;
  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await setPasswordAction(values);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Password changed");
      form.reset();
    }),
  );
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField id="new-password" label="New password" error={errors.password?.message} hint="At least 10 characters with letters and numbers.">
        <Input id="new-password" type="password" autoComplete="new-password" {...form.register("password")} />
      </FormField>
      <FormField id="confirm-password" label="Confirm new password" error={errors.confirmPassword?.message}>
        <Input id="confirm-password" type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
      </FormField>
      <Button type="submit" variant="dark" loading={pending}>Change password</Button>
    </form>
  );
}
