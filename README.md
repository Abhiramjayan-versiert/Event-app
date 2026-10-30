# EVENT APP

**EVENT APP** is a multi-college event management and operations platform. A central Super Admin manages colleges and events, appoints administrators and department heads, and oversees registrations, finance, sponsorship and operations from one dashboard. Each event gets an isolated workspace, and a separate public event website can push registrations and verified payments in through a secure, versioned API.

Built with Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui-style components on Radix · Supabase (Postgres, Auth, Storage, Realtime) · Recharts · TanStack Table · React Hook Form · Zod.

## Status

The product is built in ten phases (see `docs/architecture.md`).

| Phase | Scope | Status |
|---|---|---|
| 1 — Foundation | Project setup, branding, design system, Supabase clients, **full database schema (44 tables)**, RLS, auth, profiles, permission matrix | ✅ Done |
| 2 — Administration | Super Admin / College Admin dashboard, colleges, events, event workspace & settings, users, roles & permissions, audit log | ✅ Done |
| 3 — Departments | Department screens, head assignment, team management | ⏳ Next — schema, RLS and workspace bootstrap already in place |
| 4 — Finance | Ledger, income, expense workflow, budgets | ⏳ Schema, immutability rules and financial summary done & tested; screens/RPCs pending |
| 5 — Registrations | Registration dashboard, public website API, payment webhooks | ⏳ Schema, dedupe, API credential tables done; endpoints pending |
| 6–10 | Sponsorship, operations, communication, reporting, hardening | ⏳ Schema done; screens pending |

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

## Creating the first Super Admin (staging and production)

Nobody can register as Super Admin, and public sign-ups are disabled. Provision the first one with the service-role key from a trusted machine:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> NEXT_PUBLIC_APP_URL=https://<your-domain> node scripts/provision-super-admin.mjs owner@college.edu "Owner Name"
```

Alternatively, run this in the Supabase SQL editor after the user exists:

```sql
update public.profiles set is_super_admin = true where email = 'owner@college.edu';
```

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
