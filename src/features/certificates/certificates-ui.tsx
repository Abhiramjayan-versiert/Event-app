"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Award, ExternalLink, Mail, RotateCcw, ShieldX } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { emailCertificatesAction, issueCertificatesAction, saveCertificateSettingsAction, setCertificateRevokedAction } from "./actions";
import type { CertificateSettings } from "./pdf";

export type CertRow = { id: string; code: string; kind: string; title: string; recipient_name: string; recipient_email: string | null; emailed_at: string | null; revoked_at: string | null };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) => start(async () => {
    const r = await fn();
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Done");
    router.refresh();
  });
  return { pending, run };
}

export function IssuePanel({ eventId, canManage }: { eventId: string; canManage: boolean }) {
  const [onlyCheckedIn, setOnlyCheckedIn] = useState(true);
  const { pending, run } = useRun();
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={pending} onClick={() => run(() => issueCertificatesAction(eventId, "participation", onlyCheckedIn))}><Award /> Issue participation certificates</Button>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={onlyCheckedIn} onCheckedChange={(c) => setOnlyCheckedIn(c === true)} /> Only people who checked in
      </label>
      <Button variant="outline" disabled={pending} onClick={() => run(() => issueCertificatesAction(eventId, "winner", false))}><Award /> Issue winner certificates</Button>
      <Button variant="outline" disabled={pending} onClick={() => run(() => emailCertificatesAction(eventId))}><Mail /> Email unsent certificates</Button>
    </div>
  );
}

export function CertificateSettingsForm({ eventId, defaults, canEdit }: { eventId: string; defaults: CertificateSettings; canEdit: boolean }) {
  const [v, setV] = useState({
    signatory_1_name: defaults.signatory_1_name ?? "", signatory_1_title: defaults.signatory_1_title ?? "",
    signatory_2_name: defaults.signatory_2_name ?? "", signatory_2_title: defaults.signatory_2_title ?? "", footer: defaults.footer ?? "",
  });
  const { pending, run } = useRun();
  const field = (k: keyof typeof v, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cs-${k}`}>{label}</Label>
      <Input id={`cs-${k}`} value={v[k]} disabled={!canEdit} maxLength={k === "footer" ? 160 : 80} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </div>
  );
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => saveCertificateSettingsAction(eventId, v)); }}>
      {field("signatory_1_name", "Signatory 1 name")}{field("signatory_1_title", "Signatory 1 title")}
      {field("signatory_2_name", "Signatory 2 name")}{field("signatory_2_title", "Signatory 2 title")}
      <div className="sm:col-span-2">{field("footer", "Footer line (optional)")}</div>
      {canEdit ? <div><Button type="submit" variant="outline" loading={pending}>Save details</Button></div> : null}
    </form>
  );
}

export function CertificatesTable({ eventId, rows, canManage }: { eventId: string; rows: CertRow[]; canManage: boolean }) {
  const { pending, run } = useRun();
  if (!rows.length) return <p className="text-sm text-muted-foreground">No certificates issued yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead>Recipient</TableHead><TableHead>Certificate</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell><p className="font-medium">{c.recipient_name}</p><p className="text-xs text-muted-foreground">{c.recipient_email ?? "no email"}</p></TableCell>
              <TableCell className="text-sm">{c.title}</TableCell>
              <TableCell>
                {c.revoked_at ? <Badge variant="destructive">Revoked</Badge> : c.emailed_at ? <Badge variant="lime">Emailed</Badge> : <Badge variant="muted">Issued</Badge>}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="sm"><a href={`/c/${c.code.toLowerCase()}`} target="_blank" rel="noreferrer"><ExternalLink /> View</a></Button>
                  {canManage ? (c.revoked_at
                    ? <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setCertificateRevokedAction(eventId, c.id, false))}><RotateCcw /> Restore</Button>
                    : <Button variant="ghost" size="sm" disabled={pending} onClick={() => { if (confirm(`Revoke ${c.recipient_name}'s certificate?`)) run(() => setCertificateRevokedAction(eventId, c.id, true)); }}><ShieldX /> Revoke</Button>) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
