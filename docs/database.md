# Database

PostgreSQL on Supabase. All schema lives in `supabase/migrations`; never change a hosted database by hand.

| Migration | Contents |
|---|---|
| `…0001_foundation` | enums, `profiles`, roles/permissions, colleges, events, event settings/members, departments/members, scope guard, counters, permission-resolution functions |
| `…0002_operations_schema` | registrations, competitions, payments, webhook journal, vendors, documents, sponsorship, budgets, expenses, ledger, tasks, announcements, notifications, operations, media, marketing, activity/audit logs, API credentials, idempotency and rate-limit tables |
| `…0003_business_logic` | workspace bootstrap, numbering, dedupe keys, ledger guard (immutability), append-only tables, audit triggers, `financial_summary` |
| `…0004_row_level_security` | RLS policies for every table, task assignee guard, document access function, revoked grants |
| `…0005_app_rpc_storage` | `my_access`, `my_event_permissions`, `global_dashboard`, `event_dashboard`, storage buckets and policies, realtime publication |
| `…0006_permission_matrix` | default permissions, roles and grants |
| `…0007_administration` | `check_permission`, college archive bookkeeping, membership end stamps |

## Conventions

- UUID primary keys (`gen_random_uuid()`), `created_at` / `updated_at` (trigger maintained).
- Every event-scoped row has `event_id` and `college_id`. The `app.scope_guard` trigger derives `college_id` from the event, verifies `department_id` belongs to the same event, and blocks moving rows between events. Child rows (registration items, task assignments, deal payments and so on) inherit `event_id` from their parent.
- Soft archival, not deletion: colleges and events use `status = 'archived'` with `archived_at`/`archived_by`. Registrations, payments, sponsorship payments, expense requests and ledger rows **cannot be deleted** (trigger enforced).
- Membership history: `ended_at`, `ended_by` and `end_reason` replace deletes. Partial unique indexes enforce one active assignment per user per role/department and one active head per department.
- Human-readable numbers (`REG-000001`, `EXP-000001`, `TXN-000001`) come from a per-event counter, so concurrent inserts are safe.
- The private schema `app` holds helpers and internal tables (counters, idempotency keys, rate limits) and is not exposed through the Data API.

## Financial rules

The ledger (`financial_transactions`) is the single source of truth for money that actually moved.

- `kind`: `income`, `expense`, `refund`, `reversal` or `adjustment`. `direction` is derived and cannot be supplied by clients.
- Status flow: `pending → verified | rejected`, then `verified → reversed` only after a reversal entry exists. Amounts, categories, links and dates are immutable.
- A gateway payment, and likewise a sponsorship payment, can be booked as income **at most once** (unique partial indexes), which makes webhook processing idempotent at the database level.

`app.financial_summary(event_ids, from, to)` computes every figure shown in the UI:

| Figure | Formula |
|---|---|
| Registration income | Σ verified income, categories `online_registration` and `offline_registration` |
| Sponsorship income | Σ verified income, category `sponsorship` |
| Other income | Σ other verified income + verified inbound adjustments |
| **Total income received** | registration + sponsorship + other |
| Refunds paid | Σ verified refunds |
| **Expenditure paid** | Σ verified expenses + verified outbound adjustments |
| Approved unpaid | Σ (approved − paid) over approved / partially paid requests |
| Sponsorship committed | Σ agreed amount of confirmed / partially / fully paid deals |
| **Outstanding sponsorship** | Σ max(agreed − received, 0) over those deals |
| **Net cash position** | total income − refunds − expenditure paid |

Pending, failed and rejected entries are never counted. Commitments are never counted as cash, and approved-but-unpaid expenses are never counted as paid. A reversed transaction drops out of the totals, and its reversal row is informational only. These rules are covered by `tests/db/finance-and-tasks.test.ts`.

## Event closing

`event_closure_status(event)` returns the closing checklist (financial summary, registration counts, unverified transactions, open expense requests, approved-unpaid requests, unfinished tasks, pending deliverables and sponsorship payments, and per-department progress). It needs `event.close` or `finance.view`.

`close_event_finances(event, note)` needs `event.close`, an event in `completed` or `archived` status, a note, and **zero** unverified transactions, open expense requests and unverified sponsorship payments. It stores the checklist as `events.closing_summary` (a frozen snapshot) and stamps `financially_closed_at/_by`.

After closure:

- inserts into `financial_transactions`, `expense_requests` and `sponsorship_payments` are rejected by trigger;
- the closure columns can only change inside the closing RPCs (`events_guard_closure` trigger), so event managers cannot clear them with a direct update;
- the event can only move between `completed` and `archived`.

Only a Super Admin can call `reopen_event_finances(event, reason)`; the reason is appended to the closing note and the activity log. Events are never deleted; archived events stay readable for reports and audit. Covered by `tests/db/closing.test.ts`.

## Reports

Reports (`src/features/reports/definitions.ts`) are built server-side with the signed-in user's client, so RLS decides which rows each role sees. A report is offered when the user holds `reports.view` and the report's module permission; exporting needs `reports.export`. Exports are generated in the browser (CSV; XLSX via exceljs; PDF via jsPDF) from at most 5,000 rows per report.

## Regenerating TypeScript types

```bash
DATABASE_URL=postgresql://postgres@localhost:54322/eventapp_rls_test npm run db:types
```

CI fails if `src/lib/database.types.ts` is out of date.
