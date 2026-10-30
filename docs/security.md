# Security

## Controls in place (Phases 1–2)

| Area | Control |
|---|---|
| Authentication | Supabase Auth (bcrypt, JWT). Sign-up is disabled and access is invitation-only. Passwords need at least 10 characters with letters and digits. Reset responses don't reveal whether an account exists. Sign-in errors are generic. |
| Sessions | `proxy.ts` refreshes the session on every request with `auth.getUser()` (validated against Auth, not just decoded). Sign-out is POST-only. Suspended users are blocked in the database (`app.active_uid()` returns null) **and** banned in Auth. |
| Authorization | RLS on all 44 public tables. A permission matrix in the database. Privileged columns (`is_super_admin`, `status`) are guarded by trigger, and users cannot promote themselves. The UI hides what users can't use, but nothing depends on that. |
| Tenancy | `college_id` is derived by trigger. Cross-event department references are rejected, and rows can't move between events. Tests cover cross-college, cross-event and cross-department access with seven role types. |
| Service role | Only in `server-only` modules, never in client bundles, and only after a `check_permission` RPC for the current user. |
| Financial integrity | Append-only ledger, immutable amounts, reversal-only corrections, no deletes on registrations, payments or expense requests, and single booking per payment. Every change is audited. |
| Audit | Generic trigger audit on 35 tables (actor, role, before/after JSON, with secrets stripped). The log is append-only and readable by Super Admin, college admins (college scope) or holders of `audit.view`. |
| Storage | `documents` bucket is private, accessible only when a matching `documents` row is readable under RLS (signed URLs). Avatars are user-folder scoped. Branding uploads need college/event manage rights. MIME types and size limits are enforced by the bucket. |
| Input | Zod validation on every server action. Same-origin redirect checks (no open redirects). CSV export neutralises formula injection. Upload filenames are sanitised. DB errors map to safe messages. |
| HTTP | HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a permissions policy. `X-Powered-By` is disabled. |
| API secrets | API keys are stored as SHA-256 hashes, and the hash columns aren't selectable through the Data API. Plaintext is shown only once (Phase 5). |

## Planned for later phases

- Phase 5: webhook HMAC verification (constant-time), idempotency keys (`app.api_idempotency_keys`), fixed-window rate limiting (`app.rate_limit_buckets`), integration logs and key rotation.
- Phase 10: Content-Security-Policy with nonces, dependency audit in CI, and a penetration test checklist.

## Secrets

Never commit `.env*` files; `.gitignore` excludes them. Only `NEXT_PUBLIC_*` values may reach the browser: the Supabase URL and anon key are designed to be public, with RLS protecting the data. `SUPABASE_SERVICE_ROLE_KEY`, payment secrets and email keys are server-only, and `src/lib/env.server.ts` imports `server-only` so leaking them fails the build. Use separate Supabase projects and separate keys for development, staging and production.

## Backup & recovery

- **Supabase backups:** daily automated backups on paid plans. Enable **Point-in-Time Recovery** for production, since financial data justifies it.
- **Logical exports:** schedule `supabase db dump --data-only` (or `pg_dump`) to encrypted off-site storage, at least weekly and before every migration.
- **Storage:** buckets aren't included in database backups. Sync the `documents` bucket to separate object storage with versioning.
- **Restore drill:** restore into a scratch project quarterly. Run `npm run test:db` against it, and reconcile `financial_summary` totals for a sample of events.
- **Migrations:** forward-only and reviewed in pull requests, applied with `supabase db push` after the backup step.
