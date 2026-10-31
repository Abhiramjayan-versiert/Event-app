-- ============================================================================
-- EVENT APP — Migration 16: protect financial-closure columns
-- ============================================================================
-- events_update lets event.manage holders edit an event row. Without this
-- guard they could clear financially_closed_at directly and bypass the
-- Super-Admin-only reopen. Closure columns may now change only inside
-- close_event_finances / reopen_event_finances, and a financially closed event
-- can only move between 'completed' and 'archived'.

create or replace function app.events_guard_closure() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.financially_closed_at is distinct from old.financially_closed_at
      or new.financially_closed_by is distinct from old.financially_closed_by
      or new.closing_summary is distinct from old.closing_summary
      or new.closing_note is distinct from old.closing_note)
     and coalesce(current_setting('app.closure_rpc', true), '') <> 'on' then
    raise exception 'Use the event closing screen to close or reopen finances' using errcode = '42501';
  end if;
  if old.financially_closed_at is not null and new.financially_closed_at is not null
     and new.status is distinct from old.status and new.status not in ('completed', 'archived') then
    raise exception 'A financially closed event can only be completed or archived. Ask a Super Admin to reopen its finances first.' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger events_guard_closure before update on public.events
  for each row execute function app.events_guard_closure();

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

  perform set_config('app.closure_rpc', 'on', true);
  update public.events
     set financially_closed_at = now(), financially_closed_by = app.active_uid(), closing_summary = v_status, closing_note = trim(p_note)
   where id = p_event;
  perform set_config('app.closure_rpc', 'off', true);
  perform app.log_activity(p_event, null, 'event.financially_closed', 'Event finances closed: ' || left(trim(p_note), 200), 'events', p_event, 'event.view');
end $$;

create or replace function public.reopen_event_finances(p_event uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only a Super Admin can reopen closed finances' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  perform set_config('app.closure_rpc', 'on', true);
  update public.events set financially_closed_at = null, financially_closed_by = null,
         closing_note = coalesce(closing_note, '') || E'\nReopened: ' || trim(p_reason)
   where id = p_event and financially_closed_at is not null;
  if not found then
    perform set_config('app.closure_rpc', 'off', true);
    raise exception 'The event is not closed' using errcode = '22023';
  end if;
  perform set_config('app.closure_rpc', 'off', true);
  perform app.log_activity(p_event, null, 'event.financially_reopened', 'Event finances reopened: ' || left(trim(p_reason), 200), 'events', p_event, 'event.view');
end $$;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
