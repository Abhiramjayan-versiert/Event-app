"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/auth";
import { requestPasswordResetAction } from "@/features/auth/actions";

export default function ForgotPasswordPage() {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await requestPasswordResetAction(values);
      if (result.ok) setSent(true);
    }),
  );

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <MailCheck className="size-6" />
        </div>
        <h1 className="text-xl font-semibold">Check your inbox</h1>
        <p className="text-sm text-muted-foreground">If that address belongs to an EVENT APP account, a reset link is on its way (check spam too). The link expires in one hour. No email? Make sure you used the address your invitation was sent to, or ask your administrator to send you a reset link.</p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">Enter the email address your EVENT APP invitation was sent to, and we will send you a secure reset link.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" autoFocus {...form.register("email")} />
        </FormField>
        <Button type="submit" className="w-full" loading={pending}>
          Send reset link
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </form>
    </div>
  );
}
