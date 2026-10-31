"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, KeyRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/shared/form-field";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  clearSandboxDataAction, createApiCredentialAction, revokeApiCredentialAction, testConnectionAction, updateIntegrationSettingsAction,
} from "@/features/registrations/actions";
import { formatDateTime, formatRelative } from "@/lib/utils";

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
}

export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={value} aria-label={label} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <Button type="button" variant="outline" size="icon" onClick={() => copy(value)} aria-label={`Copy ${label}`}><Copy /></Button>
    </div>
  );
}

export function IntegrationSettingsForm({ eventId, websiteUrl, mode }: { eventId: string; websiteUrl: string; mode: "sandbox" | "production" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState(websiteUrl);
  const [m, setM] = useState(mode);
  return (
    <form
      className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateIntegrationSettingsAction(eventId, url.trim(), m);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message ?? "Saved");
          router.refresh();
        });
      }}
    >
      <FormField id="int-url" label="Public event website URL">
        <Input id="int-url" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      </FormField>
      <FormField id="int-mode" label="Mode">
        <NativeSelect id="int-mode" value={m} onChange={(e) => setM(e.target.value as "sandbox" | "production")}>
          <option value="sandbox">Sandbox (testing)</option>
          <option value="production">Production (live)</option>
        </NativeSelect>
      </FormField>
      <Button type="submit" loading={pending}>Save</Button>
    </form>
  );
}

export function CreateKeyDialog({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("Event website");
  const [env, setEnv] = useState<"sandbox" | "production">("sandbox");
  const [key, setKey] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setKey(null); router.refresh(); } }}>
      <DialogTrigger asChild><Button><KeyRound /> New API key</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{key ? "Copy your API key now" : "Create API key"}</DialogTitle>
          <DialogDescription>
            {key ? "This is the only time the full key is shown. Store it in the website's server environment — never in browser code." : "Sandbox keys create test registrations that never reach the finance ledger."}
          </DialogDescription>
        </DialogHeader>
        {key ? (
          <div className="space-y-4">
            <CopyField value={key} label="API key" />
            <DialogFooter><Button onClick={() => setOpen(false)}>I have stored the key</Button></DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const r = await createApiCredentialAction(eventId, name, env);
                if (!r.ok) return void toast.error(r.error);
                setKey((r.data as { key: string }).key);
              });
            }}
          >
            <FormField id="k-name" label="Name"><Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></FormField>
            <FormField id="k-env" label="Environment">
              <NativeSelect id="k-env" value={env} onChange={(e) => setEnv(e.target.value as "sandbox" | "production")}>
                <option value="sandbox">Sandbox (eak_test_…)</option>
                <option value="production">Production (eak_live_…)</option>
              </NativeSelect>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={pending}>Create key</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export type CredentialRow = { id: string; name: string; environment: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

export function CredentialsList({ eventId, rows }: { eventId: string; rows: CredentialRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No API keys yet.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              {c.name}
              <Badge variant={c.environment === "production" ? "lime" : "warning"}>{c.environment}</Badge>
              {c.revoked_at ? <Badge variant="muted">Revoked</Badge> : null}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{c.key_prefix}_••••••••</p>
            <p className="text-xs text-muted-foreground">Created {formatDateTime(c.created_at)} · {c.last_used_at ? `last used ${formatRelative(c.last_used_at)}` : "never used"}</p>
          </div>
          {!c.revoked_at ? (
            <ConfirmButton variant="outline" size="sm" destructive title="Revoke this key?" description="The website will immediately stop being able to use it. Create a new key first if you are rotating." confirmLabel="Revoke" action={() => revokeApiCredentialAction(eventId, c.id)}>
              Revoke
            </ConfirmButton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function TestConnectionButton({ eventId }: { eventId: string }) {
  const [pending, startTransition] = useTransition();
  const [checks, setChecks] = useState<{ label: string; ok: boolean; detail: string }[] | null>(null);
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await testConnectionAction(eventId);
            if (!r.ok) return void toast.error(r.error);
            setChecks((r.data as { checks: typeof checks }).checks);
          })
        }
      >
        Test connection
      </Button>
      {checks ? (
        <ul className="space-y-2 text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2">
              {c.ok ? <CheckCircle2 className="mt-0.5 size-4 text-lime-dark" /> : <XCircle className="mt-0.5 size-4 text-destructive" />}
              <span><span className="font-medium">{c.label}</span> — <span className="text-muted-foreground">{c.detail}</span></span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ClearSandboxButton({ eventId, count }: { eventId: string; count: number }) {
  return (
    <ConfirmButton variant="outline" size="sm" disabled={count === 0} destructive title="Delete all test registrations?" description="Removes sandbox registrations and their simulated payments. Real data is never affected." confirmLabel="Delete test data" action={() => clearSandboxDataAction(eventId)}>
      Clear {count} test registration{count === 1 ? "" : "s"}
    </ConfirmButton>
  );
}
