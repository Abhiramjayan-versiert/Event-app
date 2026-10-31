-- ============================================================================
-- EVENT APP — Migration 15: Event closing & final settlement (Phase 9)
-- ============================================================================

alter table public.events add column closing_summary jsonb;
alter table public.events add column closing_note text;

-- Closure checklist used by the closing screen and the closing report.
create or replace function public.event_closure_status(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_event_permission(p_event, 'event.close') or app.has_event_permission(p_event, 'finance.view')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'finance', app.financial_summary(array[p_event]),
    'registrations', (select jsonb_build_object(
        'total', count(*), 'confirmed', count(*) filter (where status = 'confirmed'), 'cancelled', count(*) filter (where status = 'cancelled'),
        'pending_payment', count(*) filter (where payment_status = 'pending' and status <> 'cancelled'))
      from public.registrations where event_id = p_event and not is_test),
    'pending_transactions', (select count(*) from public.financial_transactions where event_id = p_event and status = 'pending'),
    'open_expense_requests', (select count(*) from public.expense_requests where event_id = p_event and status in ('submitted', 'under_review', 'forwarded', 'changes_requested', 'draft')),
    'unpaid_approved', (select count(*) from public.expense_requests where event_id = p_event and status in ('approved', 'partially_paid')),
    'unfinished_tasks', (select count(*) from public.tasks where event_id = p_event and status <> 'completed'),
    'pending_deliverables', (select count(*) from public.sponsorship_deliverables where event_id = p_event and status in ('pending', 'in_progress')),
    'pending_sponsorship_payments', (select count(*) from public.sponsorship_payments where event_id = p_event and status = 'pending'),
    'departments', (select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.name), '[]'::jsonb) from (
        select d.name, d.progress_pct,
               (select count(*) from public.tasks t where t.department_id = d.id) tasks,
               (select count(*) from public.tasks t where t.department_id = d.id and t.status = 'completed') completed,
               coalesce((select a.allocated_amount from public.budget_allocations a where a.department_id = d.id), 0) allocated,
               coalesce((select sum(r.paid_amount) from public.expense_requests r where r.department_id = d.id), 0) spent
        from public.departments d where d.event_id = p_event and d.status = 'active') s),
    'closed_at', (select financially_closed_at from public.events where id = p_event),
    'closing_note', (select closing_note from public.events where id = p_event)
  );
end $$;

create or replace function public.close_event_finances(p_event uuid, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.events;
  v_status jsonb;
begin
  select * into e from public.events where id = p_event for update;
  if e.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(p_event, 'event.close') then
    raise exception 'You are not allowed to close this event' using errcode = '42501';
  end if;
  if e.financially_closed_at is not null then raise exception 'The event is already financially closed' using errcode = '22023'; end if;
  if e.status not in ('completed', 'archived') then raise exception 'Mark the event as completed before closing its finances' using errcode = '22023'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Add a closing note (who reviewed the figures)' using errcode = '22023'; end if;

  v_status := public.event_closure_status(p_event);
  if (v_status ->> 'pending_transactions')::int > 0 or (v_status ->> 'open_expense_requests')::int > 0 or (v_status ->> 'pending_sponsorship_payments')::int > 0 then
    raise exception 'Resolve pending transactions, open expense requests and unverified sponsorship payments first' using errcode = '22023';
  end if;

  update public.events
     set financially_closed_at = now(), financially_closed_by = app.active_uid(), closing_summary = v_status, closing_note = trim(p_note)
   where id = p_event;
  perform app.log_activity(p_event, null, 'event.financially_closed', 'Event finances closed: ' || left(trim(p_note), 200), 'events', p_event, 'event.view');
end $$;

create or replace function public.reopen_event_finances(p_event uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only a Super Admin can reopen closed finances' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  update public.events set financially_closed_at = null, financially_closed_by = null,
         closing_note = coalesce(closing_note, '') || E'\nReopened: ' || trim(p_reason)
   where id = p_event and financially_closed_at is not null;
  if not found then raise exception 'The event is not closed' using errcode = '22023'; end if;
  perform app.log_activity(p_event, null, 'event.financially_reopened', 'Event finances reopened: ' || left(trim(p_reason), 200), 'events', p_event, 'event.view');
end $$;

-- After closure, no new money movements or requests can be recorded.
create or replace function app.block_when_financially_closed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.events where id = new.event_id and financially_closed_at is not null) then
    raise exception 'This event''s finances are closed. Ask a Super Admin to reopen them.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger financial_transactions_closed before insert on public.financial_transactions
  for each row execute function app.block_when_financially_closed();
create trigger expense_requests_closed before insert on public.expense_requests
  for each row execute function app.block_when_financially_closed();
create trigger sponsorship_payments_closed before insert on public.sponsorship_payments
  for each row execute function app.block_when_financially_closed();

do $$
declare f text;
begin
  foreach f in array array['public.event_closure_status(uuid)', 'public.close_event_finances(uuid, text)', 'public.reopen_event_finances(uuid, text)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
