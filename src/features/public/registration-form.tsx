"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { publicRegisterAction, verifyPublicPaymentAction } from "./actions";
import type { PublicCompetition } from "./types";

type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCtor = new (opts: Record<string, unknown>) => { open: () => void };

function loadRazorpay(): Promise<RazorpayCtor | null> {
  return new Promise((resolve) => {
    const w = window as unknown as { Razorpay?: RazorpayCtor };
    if (w.Razorpay) return resolve(w.Razorpay);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(w.Razorpay ?? null);
    s.onerror = () => resolve(null);
    document.body.appendChild(s);
  });
}

export function PublicRegistrationForm({
  eventId, currency, competitions, allowTeams, maxTeamSize,
}: { eventId: string; currency: string; competitions: PublicCompetition[]; allowTeams: boolean; maxTeamSize: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", email: "", phone: "", college: "", course: "", academic_year: "", team_name: "", website: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const [members, setMembers] = useState<{ name: string; email: string }[]>([]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  const chosen = competitions.filter((c) => selected.includes(c.code));
  const teamComp = chosen.find((c) => c.registration_type === "team");
  const maxMembers = Math.max(0, Math.min(teamComp?.team_max ?? maxTeamSize, maxTeamSize) - 1);
  const total = useMemo(() => chosen.reduce((s, c) => s + Number(c.fee), 0), [chosen]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected.length) return void toast.error("Choose at least one competition.");
    if (teamComp && members.filter((m) => m.name.trim()).length + 1 < teamComp.team_min) {
      return void toast.error(`${teamComp.name} needs at least ${teamComp.team_min} people including you.`);
    }
    start(async () => {
      const r = await publicRegisterAction(eventId, { ...f, competitions: selected, team_members: members.filter((m) => m.name.trim()) });
      if (!r.ok) return void toast.error(r.error);
      const { ticket, checkout } = r.data!;
      if (!checkout) return router.push(`/t/${ticket}?new=1`);
      const Razorpay = await loadRazorpay();
      if (!Razorpay) return router.push(`/t/${ticket}?new=1`);
      new Razorpay({
        key: checkout.key, order_id: checkout.order_id, amount: checkout.amount, currency: checkout.currency, name: checkout.name,
        description: "Registration fee", prefill: checkout.prefill, theme: { color: "#0A0A0A" },
        handler: async (resp: RazorpayResponse) => {
          const v = await verifyPublicPaymentAction(ticket, resp.razorpay_order_id, resp.razorpay_payment_id, resp.razorpay_signature);
          if (v.ok) toast.success(v.message ?? "Payment successful");
          else toast.error(v.error);
          router.push(`/t/${ticket}?new=1`);
        },
        modal: { ondismiss: () => router.push(`/t/${ticket}?new=1`) },
      }).open();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Competitions</legend>
        {competitions.map((c) => (
          <label key={c.code} className="flex items-start gap-2 rounded-md border p-2.5 text-sm has-[:checked]:border-primary">
            <Checkbox
              checked={selected.includes(c.code)}
              onCheckedChange={(on) => setSelected((s) => (on ? [...s, c.code] : s.filter((x) => x !== c.code)))}
              disabled={c.registration_type === "team" && !allowTeams}
              className="mt-0.5"
            />
            <span className="flex-1">{c.name}{c.registration_type === "team" ? <span className="text-muted-foreground"> · team {c.team_min}–{c.team_max}</span> : null}</span>
            <span className="font-medium">{Number(c.fee) > 0 ? formatCurrency(c.fee, currency) : "Free"}</span>
          </label>
        ))}
      </fieldset>

      {[
        ["name", "Full name", "text", "name"], ["email", "Email", "email", "email"], ["phone", "Phone", "tel", "tel"],
        ["college", "College", "text", "organization"], ["course", "Course (optional)", "text", "off"], ["academic_year", "Year (optional)", "text", "off"],
      ].map(([k, label, type, ac]) => (
        <div key={k} className="space-y-1.5">
          <Label htmlFor={`p-${k}`}>{label}</Label>
          <Input id={`p-${k}`} type={type} autoComplete={ac} value={f[k as keyof typeof f]} onChange={set(k as keyof typeof f)} required={!label.includes("optional")} />
        </div>
      ))}
      {/* Honeypot for bots; hidden from people and screen readers. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} className="hidden" aria-hidden="true" />

      {teamComp && maxMembers > 0 && (
        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Team</legend>
          <Input placeholder="Team name" value={f.team_name} onChange={set("team_name")} aria-label="Team name" />
          {members.map((m, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder={`Member ${i + 2} name`} value={m.name} onChange={(e) => setMembers((ms) => ms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Member ${i + 2} name`} />
              <Input placeholder="Email (optional)" type="email" value={m.email} onChange={(e) => setMembers((ms) => ms.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} aria-label={`Member ${i + 2} email`} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove member" onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}><X /></Button>
            </div>
          ))}
          {members.length < maxMembers ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setMembers((ms) => [...ms, { name: "", email: "" }])}><Plus /> Add member</Button>
          ) : null}
        </fieldset>
      )}

      <div className="flex items-center justify-between border-t pt-3 text-sm">
        <span className="text-muted-foreground">Total</span>
        <span className="text-lg font-semibold">{total > 0 ? formatCurrency(total, currency) : "Free"}</span>
      </div>
      <Button type="submit" className="w-full" loading={pending}>{total > 0 ? "Register & pay" : "Register"}</Button>
      <p className="text-xs text-muted-foreground">Your ticket with a QR code appears right after registering and is emailed to you.</p>
    </form>
  );
}
