import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink p-10 text-white lg:flex">
        <Logo tone="light" size="lg" />
        <div className="relative z-10 max-w-md space-y-5">
          <p className="text-4xl font-semibold leading-[1.1] tracking-tight">
            Every college event.
            <br />
            <span className="text-lime">One command centre.</span>
          </p>
          <p className="text-sm leading-relaxed text-white/60">
            Departments, registrations, sponsorships, budgets and every verified rupee — organised in a single, secure
            workspace for your institution.
          </p>
        </div>
        <div className="relative z-10 flex gap-8 text-xs text-white/40">
          <span>Role-based access</span>
          <span>Audit-ready finance</span>
          <span>Real-time dashboards</span>
        </div>
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-40 size-[28rem] rounded-full border-[48px] border-lime/10" />
      </section>
      <section className="flex flex-col items-center justify-center px-6 py-12">
        <div className="mb-10 lg:hidden">
          <Logo size="lg" />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
