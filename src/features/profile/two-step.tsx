"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const codeOk = (c: string) => /^\d{6}$/.test(c);

/** Code prompt shown after the password when two-step sign-in is on. */
export function MfaChallengeForm({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!codeOk(code)) return void toast.error("Enter the 6-digit code.");
        start(async () => {
          const supabase = createClient();
          const { data } = await supabase.auth.mfa.listFactors();
          const factor = data?.totp.find((f) => f.status === "verified");
          if (!factor) return void toast.error("No authenticator is set up for this account.");
          const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
          if (error) {
            setCode("");
            return void toast.error("That code didn't work. Check the time on your phone and try the newest code.");
          }
          router.replace(next);
          router.refresh();
        });
      }}
    >
      <Label htmlFor="mfa-code" className="sr-only">Code</Label>
      <Input
        id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus placeholder="123456"
        className="text-center text-lg tracking-[0.5em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
      <Button type="submit" className="w-full" loading={pending}>Verify</Button>
    </form>
  );
}

type Factor = { id: string; status: string; created_at: string };

/** Profile card: turn two-step sign-in on or off. */
export function TwoStepSettings() {
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null | undefined>(undefined);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();

  const refresh = async () => {
    const { data } = await createClient().auth.mfa.listFactors();
    setFactor((data?.totp.find((f) => f.status === "verified") as Factor | undefined) ?? null);
  };
  useEffect(() => { void refresh(); }, []);

  if (factor === undefined) return <p className="text-sm text-muted-foreground">Checking…</p>;

  if (factor) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-5 text-lime-dark" />
          <span>Two-step sign-in is <strong>on</strong>.</span>
          <Badge variant="muted">since {new Date(factor.created_at).toLocaleDateString()}</Badge>
        </div>
        <Button
          variant="outline" size="sm" loading={pending}
          onClick={() => {
            if (!confirm("Turn off two-step sign-in? Your account will only be protected by your password.")) return;
            start(async () => {
              const { error } = await createClient().auth.mfa.unenroll({ factorId: factor.id });
              if (error) return void toast.error("Could not turn it off. Sign out and in again with your code, then retry.");
              toast.success("Two-step sign-in turned off.");
              await refresh();
              router.refresh();
            });
          }}
        >
          <ShieldOff /> Turn off
        </Button>
      </div>
    );
  }

  if (!enrolling) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Recommended for admins and finance roles. After your password you'll also enter a 6-digit code from an authenticator
          app (Google Authenticator, Microsoft Authenticator, Authy…).
        </p>
        <Button
          loading={pending}
          onClick={() =>
            start(async () => {
              const supabase = createClient();
              // Clear half-finished attempts first.
              const { data: all } = await supabase.auth.mfa.listFactors();
              for (const f of all?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
              const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${Date.now()}` });
              if (error || !data) return void toast.error("Could not start setup. Try again.");
              setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
            })
          }
        >
          <ShieldCheck /> Turn on two-step sign-in
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Open your authenticator app and add an account by scanning this QR code.</li>
        <li>Type the 6-digit code it shows to finish.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrolling.qr} alt="QR code for your authenticator app" className="size-44 rounded-md bg-white p-2" />
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Can't scan? Enter this key manually:</p>
          <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-foreground">{enrolling.secret}</code>
        </div>
      </div>
      <form
        className="flex max-w-xs gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!codeOk(code)) return void toast.error("Enter the 6-digit code.");
          start(async () => {
            const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrolling.id, code });
            if (error) return void toast.error("That code didn't work. Try the newest code.");
            toast.success("Two-step sign-in is on. You'll need your code each time you sign in.");
            setEnrolling(null);
            setCode("");
            await refresh();
            router.refresh();
          });
        }}
      >
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Code" />
        <Button type="submit" loading={pending}>Verify</Button>
      </form>
      <Button variant="ghost" size="sm" onClick={() => setEnrolling(null)}>Cancel</Button>
    </div>
  );
}
