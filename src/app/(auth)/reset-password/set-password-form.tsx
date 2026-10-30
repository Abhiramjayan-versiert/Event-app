"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { ErrorState } from "@/components/shared/error-state";
import { setPasswordSchema, type SetPasswordInput } from "@/lib/validations/auth";
import { setPasswordAction } from "@/features/auth/actions";

export function SetPasswordForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SetPasswordInput>({ resolver: zodResolver(setPasswordSchema), defaultValues: { password: "", confirmPassword: "" } });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      setError(null);
      const result = await setPasswordAction(values);
      if (!result.ok) return setError(result.error);
      toast.success("Password saved");
      router.replace("/dashboard");
      router.refresh();
    }),
  );

  const { errors } = form.formState;
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <ErrorState message={error} /> : null}
      <FormField id="password" label="New password" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" autoFocus {...form.register("password")} />
      </FormField>
      <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
        <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
      </FormField>
      <Button type="submit" className="w-full" loading={pending}>
        Save password
      </Button>
    </form>
  );
}
