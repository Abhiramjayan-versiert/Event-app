# Security

## Controls in place

| Area | Control |
|---|---|
| Authentication | Supabase Auth (bcrypt, JWT). Sign-up is disabled and access is invitation-only. Passwords need at least 10 characters with letters and digits. Reset responses don't reveal whether an account exists. Sign-in errors are generic. |
| Sessions | `proxy.ts` refreshes the session on every request with `auth.getUser()` (validated against Auth, not just decoded). Sign-out is POST-only. Suspended users are blocked in the database (`app.active_uid()` returns null) **and** banned in Auth. |
| Authorization | RLS on all 44 public tables, driven by a permission matrix in the database. Department-scoped permissions apply only inside that department. Privileged columns (`is_super_admin`, `status`, financial-closure columns) are guarded by triggers, and users cannot promote themselves. Every state-changing RPC is `SECURITY DEFINER` with an explicit permission check and is revoked from `anon`. The UI hides what users can't use, but nothing depends on that. |
| Tenancy | `college_id` is derived by trigger. Cross-event department references are rejected, and rows can't move between events. Tests cover cross-college, cross-event and cross-department access with seven role types. |
| Service role | Only in `server-only` modules, never in client bundles, and only after a `check_permission` RPC for the current user. |
| Financial integrity | Append-only ledger, immutable amounts, reversal-only corrections, no deletes on registrations, payments or expense requests, and single booking per payment. After an event is financially closed no money movement can be inserted, and only a Super Admin can reopen. Every change is audited. |
| Public API | API keys stored as SHA-256 hashes (hash columns not selectable through the Data API; plaintext shown once). Per-key fixed-window rate limits, idempotency keys, request logs, sandbox keys isolated with `is_test`. Razorpay webhooks verified with HMAC-SHA256 in constant time; checkout signatures verified server-side and the payment re-fetched from Razorpay before booking. |
| Audit | Generic trigger audit on 35 tables (actor, role, before/after JSON, with secrets stripped). The log is append-only and readable by Super Admin, college admins (college scope) or holders of `audit.view`. |
| Storage | `documents` bucket is private, accessible only when a matching `documents` row is readable under RLS (signed URLs). Avatars are user-folder scoped. Branding uploads need college/event manage rights. MIME types and size limits are enforced by the bucket. |
| Input | Zod validation on every server action and API route. Same-origin redirect checks (no open redirects). CSV/XLSX export neutralises formula injection. Upload filenames are sanitised. DB errors map to safe messages. Report filters are validated (dates, UUIDs, length). |
| HTTP | Per-request nonce **Content-Security-Policy** (`script-src 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`/`form-action 'self'`, connections limited to the app and the Supabase project). HSTS with preload, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a permissions policy. `X-Powered-By` is disabled. |

## Advisor findings reviewed (Phase 10)

- **Security advisor — "signed-in users can execute SECURITY DEFINER function" (27):** intentional. These are the app's RPCs (e.g. `expense_transition`, `close_event_finances`); each checks the caller's permission before doing anything and is not executable by `anon`. Covered by `tests/db/*`.
- **Security advisor — leaked password protection disabled:** a dashboard setting (Authentication → Passwords). Enable it when your plan allows.
- **Performance advisor — unindexed foreign keys:** migration 17 indexes the foreign keys used in filters, joins and RLS. Audit columns (`created_by`, `verified_by`, …) and `college_id` on child tables are left unindexed on purpose; queries go through `event_id`.
- **Performance advisor — unused indexes:** expected before real traffic; re-check after the first event.
- **Performance advisor — multiple permissive policies:** merged in migration 17.
- **Dependencies:** `npm audit --omit=dev` reports moderate advisories in `minimatch` and `uuid`, pulled in by `exceljs` (archive/glob helpers and uuid v3/v5/v6 buffer mode). The exporter only writes in-memory workbooks and uses neither path. `jspdf` is pinned to a patched 4.x release.

## Penetration-test checklist

Run before each college's event goes live:

1. Sign in as a department member and request another department's rows through the REST API (`/rest/v1/expense_requests?department_id=eq.<other>`): expect an empty list.
2. Call each RPC as a user without the permission (e.g. `close_event_finances`, `verify_sponsorship_payment`): expect `42501`.
3. Try to update `profiles.is_super_admin`, `events.financially_closed_at` and a verified transaction's `amount` directly: expect rejection.
4. POST to `/api/v1/payments/webhook` with a wrong signature, and replay a valid one: expect 401, then an idempotent no-op.
5. Exceed the API rate limit with a sandbox key: expect 429 with `Retry-After`.
6. Open a document's signed URL after its expiry, and fetch `documents/<path>` without a signed URL: expect denial.
7. Inject `<script>` and `=HYPERLINK()` into names, then view and export them: expect escaped text and neutralised cells.
8. Check response headers on `/dashboard` for the CSP nonce and HSTS.

## Secrets

Never commit `.env*` files; `.gitignore` excludes them. Only `NEXT_PUBLIC_*` values may reach the browser: the Supabase URL and anon key are designed to be public, with RLS protecting the data. `SUPABASE_SERVICE_ROLE_KEY`, payment secrets and email keys are server-only, and `src/lib/env.server.ts` imports `server-only` so leaking them fails the build. Use separate Supabase projects and separate keys for development, staging and production.

## Backup & recovery

- **Supabase backups:** daily automated backups on paid plans. Enable **Point-in-Time Recovery** for production, since financial data justifies it.
- **Logical exports:** schedule `supabase db dump --data-only` (or `pg_dump`) to encrypted off-site storage, at least weekly and before every migration.
- **Storage:** buckets aren't included in database backups. Sync the `documents` bucket to separate object storage with versioning.
- **Restore drill:** restore into a scratch project quarterly. Run `npm run test:db` against it, and reconcile `financial_summary` totals for a sample of events.
- **Migrations:** forward-only and reviewed in pull requests, applied with `supabase db push` after the backup step.
