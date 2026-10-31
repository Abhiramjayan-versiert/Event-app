# EVENT APP

**EVENT APP** is a multi-college event management and operations platform. A central Super Admin manages colleges and events, appoints administrators and department heads, and oversees registrations, finance, sponsorship and operations from one dashboard. Each event gets an isolated workspace, and a separate public event website can push registrations and verified payments in through a secure, versioned API.

Built with Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui-style components on Radix · Supabase (Postgres, Auth, Storage, Realtime) · Recharts · TanStack Table · React Hook Form · Zod.

## Status

The product is built in ten phases (see `docs/architecture.md`).

| Phase | Scope | Status |
|---|---|---|
| 1 — Foundation | Project setup, branding, design system, Supabase clients, **full database schema (44 tables)**, RLS, auth, profiles, permission matrix | ✅ Done |
| 2 — Administration | Super Admin / College Admin dashboard, colleges, events, event workspace & settings, users, roles & permissions, audit log | ✅ Done |
| 3 — Departments | Department list & workspaces, head/assistant/member appointments with history, team page, department announcements | ✅ Done |
| 4 — Finance | Finance dashboard, ledger with verify/reject/reverse, income recording, expense approval workflow with limits and payments, budgets, allocations, revisions | ✅ Done |
| 5 — Registrations | Registration dashboard, participants, offline desk, refunds, competitions, public website API (keys, idempotency, rate limits, logs), Razorpay webhook & verification, sandbox mode | ✅ Done |
| 6 — Sponsorship | Sponsor CRM, pipeline board, packages, deals, payments verified by finance into the ledger, deliverables | ✅ Done |
| 7 — Operations | Tasks (list/board/calendar, my/department/all, subtasks, comments, assignments, reminders), media & PR, marketing campaigns, venues, vendors, inventory, emergency contacts, event-day master schedule | ✅ Done |
| 8 — Communication | Global/college/event/department announcements with notifications, notification centre, private document management with signed URLs and attachments on expenses, deals and tasks | ✅ Done |
| 9 — Reporting & closing | 12 reports (event summary, registrations, payments, income, expenses, budget utilization, sponsorship, department performance, tasks, marketing, participants, event closing) with date/department/category/status filters and CSV, Excel and PDF export; global reports for Super Admin and College Admins; event closing checklist, financial close with frozen snapshot, Super-Admin reopen, archive | ✅ Done |
| 10 — Hardening | Security & performance advisors reviewed and fixed (FK indexes, merged policies, closure-column guard), nonce-based Content-Security-Policy, dependency audit, penetration-test checklist, documentation | ✅ Done |

Navigation only shows modules whose screens exist, so there are no placeholder pages.

## Quick start (local development)

Requirements: Node.js ≥ 20.9, and either the [Supabase CLI](https://supabase.com/docs/guides/cli) with Docker or a hosted Supabase project.

```bash
npm install
```

```bash
cp .env.example .env.local
```

**Option A, local Supabase stack.** This applies all migrations and the dev seed:

```bash
supabase start
```

```bash
supabase db reset
```

Then put the printed API URL, anon key and service-role key into `.env.local`.

**Option B, hosted Supabase project.** Link it and push the migrations:

```bash
supabase link --project-ref <your-project-ref>
```

```bash
supabase db push
```

Then start the app:

```bash
npm run dev
```

With the local seed, sign in as `superadmin@eventapp.local` / `EventApp-dev-2026`. There is one account per role; see `supabase/seed.sql`. **The seed is for local development only.**

## The Super Admin

There is exactly one Super Admin: the account whose sign-in email is set in `app.super_admin_email()` (migration 19, currently `abhiramjayan72@gmail.com`).

- That account becomes Super Admin automatically. Nobody can grant the role to anyone else or remove it, not even through the SQL editor or the service role, and the account cannot be suspended.
- Everyone else sees the Super Admin as **"Contact Admin"**. The real name, phone, job title and photo are kept in the private `app.super_admin_identity` table and shown only to the Super Admin.
- The Super Admin has every permission everywhere. They can manage any person's college, event and department access from **Users → (person)**, and see all activity and data changes under **Activity & audit**.

If the account does not exist yet, send its invitation with:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> NEXT_PUBLIC_APP_URL=https://<your-domain> node scripts/provision-super-admin.mjs "Owner Name"
```

To hand the platform to someone else, change the email in a new migration that redefines `app.super_admin_email()`.

## Installing the app (Windows, Mac, Android, iPhone, iPad)

EVENT APP is a Progressive Web App: it installs from the browser, gets its own icon and window, and updates itself on every deploy. There is no app-store submission.

| Device | How to install |
|---|---|
| Windows / Linux / ChromeOS (Chrome or Edge) | Install icon in the address bar, or account menu → **Install app** |
| Mac (Chrome or Edge) | Same as above |
| Mac (Safari 17+) | File → **Add to Dock** |
| Android (Chrome, Edge, Samsung Internet) | Account menu → **Install app**, or browser menu → **Install app** / **Add to Home screen** |
| iPhone / iPad (Safari) | Share button → **Add to Home Screen** |

The service worker never caches pages, API responses or Supabase data (they are private and must be live). It caches only fingerprinted build files and icons, and shows a branded offline page when there is no connection. Regenerate the icons with `node scripts/generate-icons.mjs`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development, production build, production server |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (permissions, validation, CSV/redirect security, formatting) |
| `npm run test:db` | Applies every migration to a disposable local Postgres and runs the RLS, tenancy, ledger and finance tests. Needs `TEST_DATABASE_ADMIN_URL` (default `postgresql://postgres@localhost:54322/postgres`). |
| `npm run db:types` | Regenerates `src/lib/database.types.ts` from a migrated database |

## Repository layout

```
src/
  app/                 routes: (auth) login/reset, (app) dashboard/colleges/events/users/settings/audit/profile, auth route handlers
  components/          ui (design system), layout (shell, sidebar, top bar), charts, tables, forms, shared
  features/            feature modules: server actions, feature components, queries
  lib/                 supabase clients, permissions, validations (zod), auth/session, export, utils
  config/              site + navigation
  proxy.ts             session refresh + route protection (Next.js 16 "proxy", formerly middleware)
supabase/
  migrations/          SQL migrations (schema, business rules, RLS, RPCs, storage, permission matrix)
  templates/           branded auth email templates
  seed.sql             local development seed
  tests/shim/          minimal Supabase shim used ONLY by the local DB test suite
tests/unit, tests/db   Vitest suites
docs/                  architecture, database, security, deployment, API
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md): system design, tenancy model, permission model and ERD
- [`docs/database.md`](docs/database.md): tables, business rules and financial formulas
- [`docs/security.md`](docs/security.md): threat model, controls, and backup/recovery
- [`docs/deployment.md`](docs/deployment.md): Supabase and Vercel setup, environment variables, production checklist
- [`docs/api.md`](docs/api.md): public website integration API (contract for Phase 5)
