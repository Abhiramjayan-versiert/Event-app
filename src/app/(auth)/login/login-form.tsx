"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { FormField } from "@/components/shared/form-field";
import { ErrorState } from "@/components/shared/error-state";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { signInAction } from "@/features/auth/actions";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next, linkError, googleEnabled }: { next?: string; linkError?: boolean; googleEnabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(linkError ? "That link is invalid or has expired. Request a new one." : null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const result = await signInAction(values, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace(result.data?.redirectTo ?? "/dashboard");
      router.refresh();
    });
  });

  async function signInWithGoogle() {
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next ?? "/dashboard")}`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (oauthError) setError("Google sign-in is not available right now.");
  }

  const { errors } = form.formState;
  return (
    <div className="space-y-5">
      {error ? <ErrorState title="Sign in failed" message={error} /> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="email" label="Email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errors.email} {...form.register("email")} />
        </FormField>
        <FormField id="password" label="Password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register("password")} />
        </FormField>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={pending}>
          Sign in
        </Button>
      </form>
      {googleEnabled ? (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" /> or <Separator className="flex-1" />
          </div>
          <Button type="button" variant="outline" className="w-full" onClick={signInWithGoogle}>
            Continue with Google
          </Button>
        </>
      ) : null}
    </div>
  );
}
