-- ============================================================================
-- EVENT APP — Migration 4: Row Level Security
--
-- Pattern: `(select app.is_super_admin())` and
-- `event_id = any((select app.event_ids_with_permission('x'))::uuid[])` are wrapped in
-- scalar sub-selects so Postgres evaluates them once per statement.
-- Tables without a policy for an operation deny that operation.
-- ============================================================================

-- Enable RLS everywhere in public.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Data API roles have no access to the private schema's tables.
revoke all on all tables in schema app from anon, authenticated;
-- Anonymous visitors get nothing from public tables; the public website talks
-- to the versioned server API with an event-scoped key instead.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or (select app.is_super_admin())
  or id = any((select app.visible_user_ids())::uuid[])
);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_update_super on public.profiles for update to authenticated
  using ((select app.is_super_admin())) with check ((select app.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Roles & permission matrix (readable by every signed-in user; only the
-- Super Admin edits the matrix; system roles cannot be deleted)
-- ---------------------------------------------------------------------------
create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_insert on public.roles for insert to authenticated with check ((select app.is_super_admin()) and not is_system);
create policy roles_update on public.roles for update to authenticated using ((select app.is_super_admin())) with check ((select app.is_super_admin()));
create policy roles_delete on public.roles for delete to authenticated using ((select app.is_super_admin()) and not is_system);

create policy permissions_select on public.permissions for select to authenticated using (true);

create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
create policy role_permissions_insert on public.role_permissions for insert to authenticated with check ((select app.is_super_admin()));
create policy role_permissions_delete on public.role_permissions for delete to authenticated using ((select app.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Colleges
-- ---------------------------------------------------------------------------
create policy colleges_select on public.colleges for select to authenticated using (
  (select app.is_super_admin()) or id = any((select app.visible_college_ids())::uuid[])
);
create policy colleges_insert on public.colleges for insert to authenticated with check ((select app.is_super_admin()));
create policy colleges_update on public.colleges for update to authenticated
  using ((select app.is_super_admin()) or id = any((select app.college_ids_with_permission('college.manage'))::uuid[]))
  with check ((select app.is_super_admin()) or (id = any((select app.college_ids_with_permission('college.manage'))::uuid[]) and status <> 'archived'));
-- No delete policy: colleges are archived, never deleted.

create policy college_members_select on public.college_members for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_super_admin())
  or college_id = any((select app.college_ids_with_permission('college.view'))::uuid[])
);
create policy college_members_insert on public.college_members for insert to authenticated with check (
  (select app.is_super_admin()) or college_id = any((select app.college_ids_with_permission('college.users.manage'))::uuid[])
);
create policy college_members_update on public.college_members for update to authenticated
  using ((select app.is_super_admin()) or college_id = any((select app.college_ids_with_permission('college.users.manage'))::uuid[]))
  with check ((select app.is_super_admin()) or college_id = any((select app.college_ids_with_permission('college.users.manage'))::uuid[]));

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create policy events_select on public.events for select to authenticated using (
  (select app.is_super_admin())
  or college_id = any((select app.college_ids_with_permission('event.view'))::uuid[])
  or id = any((select app.event_ids_with_permission('event.view'))::uuid[])
);
create policy events_insert on public.events for insert to authenticated with check (
  (select app.is_super_admin()) or college_id = any((select app.college_ids_with_permission('college.events.create'))::uuid[])
);
create policy events_update on public.events for update to authenticated
  using ((select app.is_super_admin()) or id = any((select app.event_ids_with_permission('event.manage'))::uuid[]))
  with check ((select app.is_super_admin()) or id = any((select app.event_ids_with_permission('event.manage'))::uuid[]));

create policy event_settings_select on public.event_settings for select to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('event.view'))::uuid[])
);
create policy event_settings_update on public.event_settings for update to authenticated
  using ((select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('event.manage'))::uuid[])
         or event_id = any((select app.event_ids_with_permission('integrations.manage'))::uuid[]))
  with check ((select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('event.manage'))::uuid[])
         or event_id = any((select app.event_ids_with_permission('integrations.manage'))::uuid[]));

create policy event_members_select on public.event_members for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('event.view'))::uuid[])
);
create policy event_members_insert on public.event_members for insert to authenticated with check (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('event.members.manage'))::uuid[])
);
create policy event_members_update on public.event_members for update to authenticated
  using ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('event.members.manage'))::uuid[]))
  with check ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('event.members.manage'))::uuid[]));

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
create policy departments_select on public.departments for select to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('event.view'))::uuid[])
);
create policy departments_insert on public.departments for insert to authenticated with check (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('departments.manage'))::uuid[])
);
create policy departments_update on public.departments for update to authenticated
  using ((select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('departments.manage'))::uuid[])
         or id = any((select app.department_ids_with_permission('department.manage'))::uuid[]))
  with check ((select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('departments.manage'))::uuid[])
         or id = any((select app.department_ids_with_permission('department.manage'))::uuid[]));

create policy department_members_select on public.department_members for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('event.view'))::uuid[])
);
-- Heads and assistant heads are appointed by holders of departments.manage;
-- plain team members can be added by holders of department.members.manage.
create policy department_members_insert on public.department_members for insert to authenticated with check (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('departments.manage'))::uuid[])
  or (position = 'member' and department_id = any((select app.department_ids_with_permission('department.members.manage'))::uuid[]))
);
create policy department_members_update on public.department_members for update to authenticated
  using ((select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('departments.manage'))::uuid[])
         or (position = 'member' and department_id = any((select app.department_ids_with_permission('department.members.manage'))::uuid[])))
  with check ((select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('departments.manage'))::uuid[])
         or (position = 'member' and department_id = any((select app.department_ids_with_permission('department.members.manage'))::uuid[])));

-- ---------------------------------------------------------------------------
-- Generic event-scoped policies: view/manage permission pairs
-- ---------------------------------------------------------------------------
create or replace function app.create_event_policies(p_table text, p_view text, p_manage text, p_allow_delete boolean default false)
returns void language plpgsql as $$
begin
  execute format($f$create policy %1$I on public.%2$I for select to authenticated using (
    (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission(%3$L))::uuid[]))$f$,
    p_table || '_select', p_table, p_view);
  execute format($f$create policy %1$I on public.%2$I for insert to authenticated with check (
    (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission(%3$L))::uuid[]))$f$,
    p_table || '_insert', p_table, p_manage);
  execute format($f$create policy %1$I on public.%2$I for update to authenticated
    using ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission(%3$L))::uuid[]))
    with check ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission(%3$L))::uuid[]))$f$,
    p_table || '_update', p_table, p_manage);
  if p_allow_delete then
    execute format($f$create policy %1$I on public.%2$I for delete to authenticated using (
      (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission(%3$L))::uuid[]))$f$,
      p_table || '_delete', p_table, p_manage);
  end if;
end $$;

select app.create_event_policies('event_competitions', 'event.view', 'event.manage');
select app.create_event_policies('registrations', 'registrations.view', 'registrations.manage');
select app.create_event_policies('registration_items', 'registrations.view', 'registrations.manage', true);
select app.create_event_policies('sponsors', 'sponsors.view', 'sponsors.manage');
select app.create_event_policies('sponsorship_packages', 'sponsors.view', 'sponsors.manage', true);
select app.create_event_policies('sponsorship_deals', 'sponsors.view', 'sponsors.manage');
select app.create_event_policies('sponsorship_deliverables', 'sponsors.view', 'sponsors.manage', true);
select app.create_event_policies('venues', 'operations.view', 'operations.manage', true);
select app.create_event_policies('emergency_contacts', 'event.view', 'operations.manage', true);
select app.create_event_policies('media_assets', 'media.view', 'media.manage', true);
select app.create_event_policies('marketing_campaigns', 'marketing.view', 'marketing.manage');

-- Vendors & inventory: event-wide operations managers, or the owning department.
create policy vendors_select on public.vendors for select to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('operations.view'))::uuid[])
  or event_id = any((select app.event_ids_with_permission('finance.view'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[])
);
create policy vendors_write on public.vendors for insert to authenticated with check (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[])
);
create policy vendors_update on public.vendors for update to authenticated
  using ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
         or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[]))
  with check ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
         or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[]));

create policy inventory_select on public.inventory for select to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('operations.view'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('department.view'))::uuid[])
);
create policy inventory_insert on public.inventory for insert to authenticated with check (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[])
);
create policy inventory_update on public.inventory for update to authenticated
  using ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
         or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[]))
  with check ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
         or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[]));
create policy inventory_delete on public.inventory for delete to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
);

-- Master schedule is visible to every event member; departments maintain their own items.
create policy event_schedules_select on public.event_schedules for select to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('event.view'))::uuid[])
);
create policy event_schedules_insert on public.event_schedules for insert to authenticated with check (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[])
);
create policy event_schedules_update on public.event_schedules for update to authenticated
  using ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
         or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[]))
  with check ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
         or department_id = any((select app.department_ids_with_permission('operations.update'))::uuid[]));
create policy event_schedules_delete on public.event_schedules for delete to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('operations.manage'))::uuid[])
);

-- ---------------------------------------------------------------------------
-- Payments & webhooks: written only by the trusted backend (service role).
-- ---------------------------------------------------------------------------
create policy payments_select on public.payments for select to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('registrations.view'))::uuid[])
  or event_id = any((select app.event_ids_with_permission('finance.view'))::uuid[])
);
create policy payment_webhook_events_select on public.payment_webhook_events for select to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('integrations.manage'))::uuid[])
);

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
create policy financial_transactions_select on public.financial_transactions for select to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('finance.view'))::uuid[])
);
-- Direct inserts are limited to manually recorded income/adjustments in a
-- non-final state; expense payments and reversals go through RPCs.
create policy financial_transactions_insert on public.financial_transactions for insert to authenticated with check (
  ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('finance.manage'))::uuid[]))
  and kind in ('income', 'adjustment')
  and status in ('pending', 'verified')
  and payment_id is null and sponsorship_payment_id is null and expense_request_id is null
);
create policy financial_transactions_update on public.financial_transactions for update to authenticated
  using ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('finance.manage'))::uuid[]))
  with check ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('finance.manage'))::uuid[]));

create policy sponsorship_payments_select on public.sponsorship_payments for select to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('sponsors.view'))::uuid[])
  or event_id = any((select app.event_ids_with_permission('finance.view'))::uuid[])
);
create policy sponsorship_payments_insert on public.sponsorship_payments for insert to authenticated with check (
  ((select app.is_super_admin())
   or event_id = any((select app.event_ids_with_permission('sponsors.manage'))::uuid[])
   or event_id = any((select app.event_ids_with_permission('finance.manage'))::uuid[]))
  and status = 'pending'
);

create policy budgets_select on public.budgets for select to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('finance.view'))::uuid[])
  or event_id = any((select app.event_ids_with_permission('budgets.manage'))::uuid[])
);
create policy budgets_update on public.budgets for update to authenticated
  using ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('budgets.manage'))::uuid[]))
  with check ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('budgets.manage'))::uuid[]));

create policy budget_allocations_select on public.budget_allocations for select to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('finance.view'))::uuid[])
  or event_id = any((select app.event_ids_with_permission('budgets.manage'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('budgets.view'))::uuid[])
);
create policy budget_allocations_insert on public.budget_allocations for insert to authenticated with check (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('budgets.manage'))::uuid[])
);
create policy budget_allocations_update on public.budget_allocations for update to authenticated
  using ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('budgets.manage'))::uuid[]))
  with check ((select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('budgets.manage'))::uuid[]));

create policy budget_revisions_select on public.budget_revisions for select to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('finance.view'))::uuid[])
  or event_id = any((select app.event_ids_with_permission('budgets.manage'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('budgets.view'))::uuid[])
);
create policy budget_revisions_insert on public.budget_revisions for insert to authenticated with check (
  status = 'pending' and requested_by = (select auth.uid()) and (
    (select app.is_super_admin())
    or event_id = any((select app.event_ids_with_permission('budgets.manage'))::uuid[])
    or department_id = any((select app.department_ids_with_permission('budgets.request'))::uuid[])
  )
);

create policy expense_requests_select on public.expense_requests for select to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('finance.view'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('expenses.view'))::uuid[])
  or submitted_by = (select auth.uid())
);
create policy expense_requests_insert on public.expense_requests for insert to authenticated with check (
  status in ('draft', 'submitted')
  and approved_amount is null and paid_amount = 0
  and (
    (select app.is_super_admin())
    or event_id = any((select app.event_ids_with_permission('expenses.submit'))::uuid[])
    or department_id = any((select app.department_ids_with_permission('expenses.submit_department'))::uuid[])
  )
);
-- Submitters may edit only their own drafts / returned requests. Status
-- changes beyond that run through the approval workflow RPC.
create policy expense_requests_update_own on public.expense_requests for update to authenticated
  using (submitted_by = (select auth.uid()) and status in ('draft', 'changes_requested'))
  with check (submitted_by = (select auth.uid()) and status in ('draft', 'changes_requested', 'submitted', 'cancelled')
              and approved_amount is null and paid_amount = 0);

create policy expense_approvals_select on public.expense_approvals for select to authenticated using (
  exists (select 1 from public.expense_requests r where r.id = expense_request_id)
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create or replace function app.can_view_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and (
      app.is_super_admin()
      or app.has_event_permission(t.event_id, 'tasks.view_all')
      or (t.department_id is not null and app.has_department_permission(t.department_id, 'tasks.view'))
      or t.created_by = app.active_uid()
      or exists (select 1 from public.task_assignments a
                 where a.task_id = t.id and a.user_id = app.active_uid() and a.unassigned_at is null)
    )
  )
$$;

create or replace function app.is_task_assignee(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_assignments a
                 where a.task_id = p_task and a.user_id = app.active_uid() and a.unassigned_at is null)
$$;

create or replace function app.can_manage_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and (
      app.is_super_admin()
      or app.has_event_permission(t.event_id, 'tasks.manage_all')
      or (t.department_id is not null and app.has_department_permission(t.department_id, 'tasks.manage'))
    )
  )
$$;

create policy tasks_select on public.tasks for select to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('tasks.view_all'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('tasks.view'))::uuid[])
  or created_by = (select auth.uid())
  or app.is_task_assignee(id)
);
create policy tasks_insert on public.tasks for insert to authenticated with check (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('tasks.manage_all'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('tasks.manage'))::uuid[])
);
create policy tasks_update_manage on public.tasks for update to authenticated
  using ((select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('tasks.manage_all'))::uuid[])
         or department_id = any((select app.department_ids_with_permission('tasks.manage'))::uuid[]))
  with check ((select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('tasks.manage_all'))::uuid[])
         or department_id = any((select app.department_ids_with_permission('tasks.manage'))::uuid[]));
-- Assignees may update their task; a trigger limits which columns they touch.
create policy tasks_update_assignee on public.tasks for update to authenticated
  using (app.is_task_assignee(id))
  with check (app.is_task_assignee(id));
create policy tasks_delete on public.tasks for delete to authenticated using (
  (select app.is_super_admin())
  or event_id = any((select app.event_ids_with_permission('tasks.manage_all'))::uuid[])
  or department_id = any((select app.department_ids_with_permission('tasks.manage'))::uuid[])
);

-- SECURITY INVOKER on purpose: app.is_trusted_backend() inspects current_user,
-- which inside a SECURITY DEFINER function would be the function owner.
create or replace function app.guard_task_assignee_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if app.is_trusted_backend()
     or app.is_super_admin()
     or app.has_event_permission(new.event_id, 'tasks.manage_all')
     or (new.department_id is not null and app.has_department_permission(new.department_id, 'tasks.manage')) then
    return new;
  end if;
  if (new.title, new.description, new.priority, new.due_at, new.start_at, new.department_id, new.parent_task_id, new.module, new.task_type)
     is distinct from
     (old.title, old.description, old.priority, old.due_at, old.start_at, old.department_id, old.parent_task_id, old.module, old.task_type) then
    raise exception 'Assignees can only update status, progress and notes' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tasks_c_assignee_guard before update on public.tasks
  for each row execute function app.guard_task_assignee_update();

create or replace function app.task_completion_stamp() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
    new.progress_pct := 100;
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger tasks_d_completion before insert or update on public.tasks
  for each row execute function app.task_completion_stamp();

create policy task_assignments_select on public.task_assignments for select to authenticated using (
  user_id = (select auth.uid()) or app.can_view_task(task_id)
);
create policy task_assignments_insert on public.task_assignments for insert to authenticated with check (
  app.can_manage_task(task_id)
);
create policy task_assignments_update on public.task_assignments for update to authenticated
  using (app.can_manage_task(task_id)) with check (app.can_manage_task(task_id));

create policy task_comments_select on public.task_comments for select to authenticated using (app.can_view_task(task_id));
create policy task_comments_insert on public.task_comments for insert to authenticated with check (
  author_id = (select auth.uid()) and app.can_view_task(task_id)
);
create policy task_comments_update on public.task_comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Announcements & notifications
-- ---------------------------------------------------------------------------
create policy announcements_select on public.announcements for select to authenticated using (
  (select app.is_super_admin())
  or scope = 'global'
  or (scope = 'college' and college_id = any((select app.visible_college_ids())::uuid[]))
  or (scope = 'event' and event_id = any((select app.event_ids_with_permission('event.view'))::uuid[]))
  or (scope = 'department' and (
        event_id = any((select app.event_ids_with_permission('announcements.manage'))::uuid[])
        or department_id = any((select app.department_ids_with_permission('department.view'))::uuid[])))
);
create policy announcements_insert on public.announcements for insert to authenticated with check (
  created_by = (select auth.uid()) and (
    (select app.is_super_admin())
    or (scope = 'college' and college_id = any((select app.college_ids_with_permission('college.manage'))::uuid[]))
    or (scope = 'event' and event_id = any((select app.event_ids_with_permission('announcements.manage'))::uuid[]))
    or (scope = 'department' and (
          event_id = any((select app.event_ids_with_permission('announcements.manage'))::uuid[])
          or department_id = any((select app.department_ids_with_permission('announcements.post'))::uuid[])))
  )
);
create policy announcements_update on public.announcements for update to authenticated
  using (created_by = (select auth.uid()) or (select app.is_super_admin()))
  with check (created_by = (select auth.uid()) or (select app.is_super_admin()));
create policy announcements_delete on public.announcements for delete to authenticated
  using (created_by = (select auth.uid()) or (select app.is_super_admin()));

create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
create or replace function app.can_read_document_row(p_event uuid, p_department uuid, p_visibility public.document_visibility, p_uploaded_by uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin()
    or p_uploaded_by = app.active_uid()
    or app.has_event_permission(p_event, 'documents.view_all')
    or case p_visibility
         when 'event' then app.has_event_permission(p_event, 'event.view')
         when 'department' then p_department is not null and app.has_department_permission(p_department, 'documents.view')
         when 'finance' then app.has_event_permission(p_event, 'finance.view')
         when 'restricted' then app.has_event_permission(p_event, 'event.manage')
       end
$$;

create policy documents_select on public.documents for select to authenticated using (
  app.can_read_document_row(event_id, department_id, visibility, uploaded_by)
);
create policy documents_insert on public.documents for insert to authenticated with check (
  uploaded_by = (select auth.uid()) and (
    (select app.is_super_admin())
    or event_id = any((select app.event_ids_with_permission('documents.upload'))::uuid[])
    or department_id = any((select app.department_ids_with_permission('documents.upload'))::uuid[])
  )
);
create policy documents_update on public.documents for update to authenticated
  using (uploaded_by = (select auth.uid()) or (select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('documents.view_all'))::uuid[]))
  with check (uploaded_by = (select auth.uid()) or (select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('documents.view_all'))::uuid[]));

-- ---------------------------------------------------------------------------
-- Activity, audit, integrations
-- ---------------------------------------------------------------------------
create policy activity_log_select on public.activity_log for select to authenticated using (
  (select app.is_super_admin())
  or (event_id is not null and app.has_event_permission(event_id, required_permission))
  or (event_id is null and college_id = any((select app.college_ids_with_permission('college.view'))::uuid[]))
);

create policy audit_logs_select on public.audit_logs for select to authenticated using (
  (select app.is_super_admin())
  or (event_id is not null and event_id = any((select app.event_ids_with_permission('audit.view'))::uuid[]))
  or (event_id is null and college_id = any((select app.college_ids_with_permission('college.manage'))::uuid[]))
);

create policy api_credentials_select on public.api_credentials for select to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('integrations.manage'))::uuid[])
);
-- Hashes are never readable through the Data API, even by managers: replace
-- the table-level grant with an explicit column allow-list.
revoke select on public.api_credentials from authenticated;
grant select (id, event_id, college_id, name, environment, key_prefix, scopes, created_by, last_used_at,
              expires_at, revoked_at, revoked_by, created_at, updated_at)
  on public.api_credentials to authenticated;

create policy api_integration_logs_select on public.api_integration_logs for select to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('integrations.manage'))::uuid[])
);

-- Audit/activity/notification rows are written by SECURITY DEFINER functions only.
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.activity_log from authenticated;
revoke insert on public.notifications from authenticated;
revoke insert, update, delete on public.payment_webhook_events from authenticated;
revoke insert, update, delete on public.payments from authenticated;
revoke insert, update, delete on public.api_integration_logs from authenticated;
revoke insert, update, delete on public.api_credentials from authenticated;
