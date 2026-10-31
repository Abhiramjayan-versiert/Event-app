-- ============================================================================
-- EVENT APP — Migration 17: performance hardening (Phase 10)
-- ============================================================================
-- 1. Cover foreign keys that are used in filters, joins and RLS predicates.
--    Partial indexes skip NULLs for optional links. Audit "*_by" columns and
--    college_id (queries always go through event_id) are intentionally left
--    unindexed to keep writes cheap.
create index if not exists activity_log_department_id_fk_idx on public.activity_log (department_id) where department_id is not null;
create index if not exists announcements_department_id_fk_idx on public.announcements (department_id) where department_id is not null;
create index if not exists budget_revisions_department_id_fk_idx on public.budget_revisions (department_id) where department_id is not null;
create index if not exists documents_department_id_fk_idx on public.documents (department_id) where department_id is not null;
create index if not exists event_competitions_department_id_fk_idx on public.event_competitions (department_id) where department_id is not null;
create index if not exists event_schedules_department_id_fk_idx on public.event_schedules (department_id) where department_id is not null;
create index if not exists financial_transactions_department_id_fk_idx on public.financial_transactions (department_id) where department_id is not null;
create index if not exists inventory_department_id_fk_idx on public.inventory (department_id) where department_id is not null;
create index if not exists marketing_campaigns_department_id_fk_idx on public.marketing_campaigns (department_id) where department_id is not null;
create index if not exists media_assets_department_id_fk_idx on public.media_assets (department_id) where department_id is not null;
create index if not exists vendors_department_id_fk_idx on public.vendors (department_id) where department_id is not null;
create index if not exists budget_allocations_event_id_fk_idx on public.budget_allocations (event_id);
create index if not exists expense_approvals_event_id_fk_idx on public.expense_approvals (event_id);
create index if not exists notifications_event_id_fk_idx on public.notifications (event_id);
create index if not exists registration_items_event_id_fk_idx on public.registration_items (event_id);
create index if not exists sponsorship_deliverables_event_id_fk_idx on public.sponsorship_deliverables (event_id);
create index if not exists sponsorship_payments_event_id_fk_idx on public.sponsorship_payments (event_id);
create index if not exists task_assignments_event_id_fk_idx on public.task_assignments (event_id);
create index if not exists task_comments_event_id_fk_idx on public.task_comments (event_id);
create index if not exists marketing_campaigns_owner_id_fk_idx on public.marketing_campaigns (owner_id) where owner_id is not null;
create index if not exists sponsorship_deals_owner_id_fk_idx on public.sponsorship_deals (owner_id) where owner_id is not null;
create index if not exists sponsorship_deliverables_owner_id_fk_idx on public.sponsorship_deliverables (owner_id) where owner_id is not null;
create index if not exists college_members_role_id_fk_idx on public.college_members (role_id);
create index if not exists department_members_role_id_fk_idx on public.department_members (role_id);
create index if not exists event_members_role_id_fk_idx on public.event_members (role_id);
create index if not exists financial_transactions_sponsor_id_fk_idx on public.financial_transactions (sponsor_id) where sponsor_id is not null;
create index if not exists sponsorship_payments_sponsor_id_fk_idx on public.sponsorship_payments (sponsor_id) where sponsor_id is not null;
create index if not exists expense_requests_vendor_id_fk_idx on public.expense_requests (vendor_id) where vendor_id is not null;
create index if not exists inventory_vendor_id_fk_idx on public.inventory (vendor_id) where vendor_id is not null;
create index if not exists event_schedules_venue_id_fk_idx on public.event_schedules (venue_id) where venue_id is not null;
create index if not exists inventory_venue_id_fk_idx on public.inventory (venue_id) where venue_id is not null;
create index if not exists sponsorship_deals_package_id_fk_idx on public.sponsorship_deals (package_id) where package_id is not null;
create index if not exists payment_webhook_events_payment_id_fk_idx on public.payment_webhook_events (payment_id) where payment_id is not null;
create index if not exists financial_transactions_registration_id_fk_idx on public.financial_transactions (registration_id) where registration_id is not null;
create index if not exists event_schedules_competition_id_fk_idx on public.event_schedules (competition_id) where competition_id is not null;
create index if not exists api_integration_logs_credential_id_fk_idx on public.api_integration_logs (credential_id);
create index if not exists registrations_api_credential_id_fk_idx on public.registrations (api_credential_id) where api_credential_id is not null;
create index if not exists budget_allocations_budget_id_fk_idx on public.budget_allocations (budget_id);
create index if not exists media_assets_task_id_fk_idx on public.media_assets (task_id) where task_id is not null;
create index if not exists sponsors_assigned_to_fk_idx on public.sponsors (assigned_to) where assigned_to is not null;

-- 2. One permissive UPDATE policy per table (same semantics: permissive
--    policies are OR-ed) so Postgres evaluates a single expression.
drop policy profiles_update_self on public.profiles;
drop policy profiles_update_super on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select app.is_super_admin()))
  with check (id = (select auth.uid()) or (select app.is_super_admin()));

drop policy tasks_update_assignee on public.tasks;
drop policy tasks_update_manage on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    (select app.is_super_admin())
    or event_id = any((select app.event_ids_with_permission('tasks.manage_all'))::uuid[])
    or department_id = any((select app.department_ids_with_permission('tasks.manage'))::uuid[])
    or app.is_task_assignee(id)
  )
  with check (
    (select app.is_super_admin())
    or event_id = any((select app.event_ids_with_permission('tasks.manage_all'))::uuid[])
    or department_id = any((select app.department_ids_with_permission('tasks.manage'))::uuid[])
    or app.is_task_assignee(id)
  );
