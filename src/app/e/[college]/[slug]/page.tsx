import { notFound } from "next/navigation";
import { CalendarDays, Mail, MapPin, Phone } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicStorageUrl } from "@/lib/storage";
import { formatCurrency, formatDateRange } from "@/lib/utils";
import { PublicRegistrationForm } from "@/features/public/registration-form";
import { registrationState, type PublicEvent } from "@/features/public/types";

export const dynamic = "force-dynamic";

async function load(college: string, slug: string) {
  if (!/^[a-z0-9-]{1,40}$/i.test(college) || !/^[a-z0-9-]{1,80}$/i.test(slug)) return null;
  const { data } = await createAdminClient().rpc("public_event_info", { p_college_code: college, p_slug: slug });
  return (data as PublicEvent | null) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ college: string; slug: string }> }) {
  const { college, slug } = await params;
  const e = await load(college, slug);
  return { title: e ? `${e.name} · ${e.college.name}` : "Event", robots: { index: e?.public_page ?? false, follow: false } };
}

/** Public event page with online registration (no sign-in). */
export default async function PublicEventPage({ params }: { params: Promise<{ college: string; slug: string }> }) {
  const { college, slug } = await params;
  const e = await load(college, slug);
  if (!e) notFound();
  const state = registrationState(e);
  const { data: resultsData } = await createAdminClient().rpc("public_results", { p_event: e.id });
  const results = (resultsData as { competition: string; results: { position: number; title: string; name: string; college: string | null }[] | null }[] | null) ?? [];
  const banner = publicStorageUrl("branding", e.banner_path);
  const logo = publicStorageUrl("branding", e.logo_path);

  return (
    <div className="min-h-screen bg-background">
      <header className="relative overflow-hidden bg-ink text-white">
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner} alt="" className="absolute inset-0 size-full object-cover opacity-35" />
        ) : null}
        <div className="relative mx-auto max-w-4xl space-y-4 px-4 py-12 sm:px-6 sm:py-16">
          <div className="flex items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="size-12 rounded-md bg-white object-contain p-1" />
            ) : null}
            <p className="text-sm font-medium text-white/70">{e.college.name}</p>
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-5xl">{e.name}</h1>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4 text-lime" />{formatDateRange(e.starts_on, e.ends_on)}</span>
            {e.venue ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-lime" />{e.venue}</span> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          {e.description ? <p className="whitespace-pre-line text-muted-foreground">{e.description}</p> : null}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Competitions</h2>
            {e.competitions.length === 0 ? <p className="text-sm text-muted-foreground">Competitions will be announced soon.</p> : (
              <ul className="space-y-3">
                {e.competitions.map((c) => (
                  <li key={c.code} className="rounded-lg border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.registration_type === "team" ? `Team of ${c.team_min}–${c.team_max}` : "Individual"}
                          {c.starts_at ? ` · ${new Date(c.starts_at).toLocaleString("en-IN", { timeZone: e.timezone, dateStyle: "medium", timeStyle: "short" })}` : ""}
                          {c.venue ? ` · ${c.venue}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{Number(c.fee) > 0 ? formatCurrency(c.fee, e.currency) : "Free"}</p>
                        {c.spots_left !== null ? <p className="text-xs text-muted-foreground">{c.spots_left > 0 ? `${c.spots_left} spots left` : "Full"}</p> : null}
                      </div>
                    </div>
                    {c.description ? <p className="mt-2 text-sm text-muted-foreground">{c.description}</p> : null}
                    {c.rules_url ? <a href={c.rules_url} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-sm underline underline-offset-4">Rules</a> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {results.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Results</h2>
              {results.map((r) => (
                <div key={r.competition} className="rounded-lg border bg-card p-4">
                  <p className="mb-2 font-medium">{r.competition}</p>
                  <ol className="space-y-1 text-sm">
                    {(r.results ?? []).map((w) => (
                      <li key={`${w.position}-${w.name}`} className="flex justify-between gap-2">
                        <span><span className="font-semibold">{w.title}</span> · {w.name}</span>
                        {w.college ? <span className="text-muted-foreground">{w.college}</span> : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </section>
          )}
          {(e.contact_email || e.contact_phone) && (
            <section className="space-y-2 text-sm">
              <h2 className="text-lg font-semibold">Contact</h2>
              {e.contact_email ? <a href={`mailto:${e.contact_email}`} className="flex items-center gap-2 hover:underline"><Mail className="size-4" />{e.contact_email}</a> : null}
              {e.contact_phone ? <a href={`tel:${e.contact_phone}`} className="flex items-center gap-2 hover:underline"><Phone className="size-4" />{e.contact_phone}</a> : null}
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="mb-4 text-lg font-semibold">Register</h2>
            {state.open ? (
              <PublicRegistrationForm
                eventId={e.id}
                currency={e.currency}
                competitions={e.competitions.filter((c) => c.spots_left === null || c.spots_left > 0)}
                allowTeams={e.allow_team_registrations}
                maxTeamSize={e.max_team_size}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{state.reason}</p>
            )}
          </div>
        </aside>
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Powered by <Logo size="sm" />
      </footer>
    </div>
  );
}
