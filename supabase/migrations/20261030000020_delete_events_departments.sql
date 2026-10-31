-- ============================================================================
-- EVENT APP — Migration 20: delete events and departments safely
-- ============================================================================
-- Deleting is offered only while nothing of financial or participant record
-- would be lost. Events or departments with real registrations, payments,
-- ledger entries, expense requests or sponsorship payments must be archived
-- instead (those records are append-only by design). Sandbox (test) data is
-- removed together with the event. The audit log keeps every deleted row.

create or replace function public.delete_event(p_event uuid, p_confirm_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.events;
  v_paths text[];
begin
  select * into e from public.events where id = p_event for update;
  if e.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not (app.is_super_admin() or e.college_id = any(app.college_ids_with_permission('college.manage'))) then
    raise exception 'Only a Super Admin or a College Admin can delete events' using errcode = '42501';
  end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(e.name)) then
    raise exception 'Type the event name exactly to confirm' using errcode = '22023';
  end if;
  if exists (select 1 from public.registrations where event_id = p_event and not is_test)
     or exists (select 1 from public.payments where event_id = p_event and not is_test)
     or exists (select 1 from public.financial_transactions where event_id = p_event)
     or exists (select 1 from public.expense_requests where event_id = p_event)
     or exists (select 1 from public.sponsorship_payments where event_id = p_event) then
    raise exception 'This event has registrations, payments or financial records, which must be kept. Archive it instead.' using errcode = '22023';
  end if;

  select coalesce(array_agg(storage_path), '{}') into v_paths from public.documents where event_id = p_event and bucket = 'documents';

  -- Children first (most foreign keys are RESTRICT on purpose).
  delete from public.payments where event_id = p_event and is_test;
  delete from public.registrations where event_id = p_event and is_test;   -- registration_items cascade
  update public.tasks set parent_task_id = null where event_id = p_event and parent_task_id is not null;
  delete from public.tasks where event_id = p_event;                        -- assignments, comments cascade
  delete from public.sponsorship_deliverables where event_id = p_event;
  delete from public.sponsorship_deals where event_id = p_event;
  delete from public.sponsorship_packages where event_id = p_event;
  delete from public.sponsors where event_id = p_event;
  delete from public.budget_revisions where event_id = p_event;
  delete from public.budget_allocations where event_id = p_event;
  delete from public.budgets where event_id = p_event;
  delete from public.registration_items where event_id = p_event;
  delete from public.event_schedules where event_id = p_event;
  delete from public.event_competitions where event_id = p_event;
  delete from public.inventory where event_id = p_event;
  delete from public.vendors where event_id = p_event;
  delete from public.venues where event_id = p_event;
  delete from public.emergency_contacts where event_id = p_event;
  delete from public.marketing_campaigns where event_id = p_event;
  delete from public.media_assets where event_id = p_event;
  delete from public.announcements where event_id = p_event;
  update public.documents set previous_version_id = null where event_id = p_event and previous_version_id is not null;
  delete from public.documents where event_id = p_event;
  delete from public.department_members where event_id = p_event;
  delete from public.departments where event_id = p_event;
  delete from public.event_members where event_id = p_event;
  delete from public.api_credentials where event_id = p_event;
  delete from public.events where id = p_event;                            -- settings, notifications, activity cascade

  insert into public.activity_log (college_id, actor_id, activity_type, summary, entity_type, entity_id, required_permission)
  values (e.college_id, app.active_uid(), 'event.deleted', 'Event deleted: ' || left(e.name, 200), 'events', e.id, 'college.manage');

  return jsonb_build_object('document_paths', to_jsonb(v_paths));
end $$;

create or replace function public.delete_department(p_department uuid, p_confirm_name text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.departments;
begin
  select * into d from public.departments where id = p_department for update;
  if d.id is null then raise exception 'Department not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(d.event_id, 'departments.manage') then
    raise exception 'You are not allowed to delete departments in this event' using errcode = '42501';
  end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(d.name)) then
    raise exception 'Type the department name exactly to confirm' using errcode = '22023';
  end if;
  if exists (select 1 from public.expense_requests where department_id = p_department)
     or exists (select 1 from public.financial_transactions where department_id = p_department)
     or exists (select 1 from public.budget_revisions where department_id = p_department)
     or exists (select 1 from public.budget_allocations where department_id = p_department and allocated_amount > 0) then
    raise exception 'This department has a budget or expense records, which must be kept. Archive it instead.' using errcode = '22023';
  end if;

  -- Work is kept: tasks move to event level. Assignments and department posts go.
  update public.tasks set department_id = null where department_id = p_department;
  -- Department-only documents become restricted (event managers) rather than visible to all.
  update public.documents set visibility = 'restricted' where department_id = p_department and visibility = 'department';
  delete from public.announcements where department_id = p_department;
  delete from public.budget_allocations where department_id = p_department;
  delete from public.department_members where department_id = p_department;
  delete from public.departments where id = p_department;               -- documents, schedule, etc. set null

  perform app.log_activity(d.event_id, null, 'department.deleted', 'Department deleted: ' || left(d.name, 200), 'departments', d.id, 'event.view');
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.delete_event(uuid, text)', 'public.delete_department(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
