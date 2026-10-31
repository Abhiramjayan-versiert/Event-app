-- ============================================================================
-- EVENT APP — Migration 31: cancel / delete events and competitions, removal log
-- ============================================================================
-- * Events get a 'cancelled' status (kept for records, closed for registration).
--   Cancelling and restoring go through RPCs only (guard trigger).
-- * Competitions can be cancelled (hidden, closed) or deleted (only without
--   registrations).
-- * Every cancel/delete is written to public.removal_log. The Super Admin's
--   dashboard lists the ones done by other admins and can clear the list.

alter type public.event_status add value if not exists 'cancelled';
-- Deleted accounts: login removed, email freed, history kept under the old profile.
alter type public.account_status add value if not exists 'deleted';

alter table public.events
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles (id) on delete set null,
  add column cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500);
alter table public.event_competitions
  add column cancelled_at timestamptz,
  add column cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500);

create table public.removal_log (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('event', 'competition')),
  action text not null check (action in ('cancelled', 'deleted')),
  item_name text not null,
  college_id uuid references public.colleges (id) on delete set null,
  college_name text,
  event_id uuid,
  event_name text,
  performed_by uuid references public.profiles (id) on delete set null,
  performer_name text,
  by_super_admin boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);
create index removal_log_open_idx on public.removal_log (created_at desc) where cleared_at is null and not by_super_admin;
alter table public.removal_log enable row level security;
create policy removal_log_select on public.removal_log for select to authenticated using ((select app.is_super_admin()));

create or replace function app.log_removal(p_type text, p_action text, p_name text, p_college uuid, p_event uuid, p_event_name text, p_reason text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.removal_log (item_type, action, item_name, college_id, college_name, event_id, event_name, performed_by, performer_name, by_super_admin, reason)
  select p_type, p_action, left(p_name, 200), p_college, (select name from public.colleges where id = p_college), p_event, left(p_event_name, 200),
         app.active_uid(), (select full_name from public.profiles where id = app.active_uid()), app.is_super_admin(), nullif(left(trim(p_reason), 500), '')
$$;

-- Cancelled status changes only through cancel_event / restore_event.
create or replace function app.events_guard_cancel() returns trigger
language plpgsql set search_path = '' as $$
begin
  if ((new.status::text = 'cancelled') is distinct from (old.status::text = 'cancelled')
      or new.cancelled_at is distinct from old.cancelled_at)
     and coalesce(current_setting('app.cancel_rpc', true), '') <> 'on' then
    raise exception 'Use Cancel event / Restore event to change cancellation' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger events_guard_cancel before update on public.events for each row execute function app.events_guard_cancel();

-- No new registrations for a cancelled event.
create or replace function app.registrations_block_cancelled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.events where id = new.event_id and status::text = 'cancelled') then
    raise exception 'This event has been cancelled' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger registrations_block_cancelled before insert on public.registrations for each row execute function app.registrations_block_cancelled();

create or replace function app.can_remove_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or exists (select 1 from public.events e where e.id = p_event and e.college_id = any(app.college_ids_with_permission('college.manage')))
$$;

create or replace function public.cancel_event(p_event uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event for update;
  if e.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not app.can_remove_event(p_event) then raise exception 'Only a Super Admin or a College Admin can cancel events' using errcode = '42501'; end if;
  if e.status::text = 'cancelled' then raise exception 'The event is already cancelled' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' and not app.is_super_admin() then raise exception 'Give a reason for cancelling' using errcode = '22023'; end if;
  perform set_config('app.cancel_rpc', 'on', true);
  update public.events set status = 'cancelled', cancelled_at = now(), cancelled_by = app.active_uid(), cancel_reason = nullif(left(trim(p_reason), 500), '')
   where id = p_event;
  perform set_config('app.cancel_rpc', 'off', true);
  perform app.log_removal('event', 'cancelled', e.name, e.college_id, e.id, e.name, p_reason);
  perform app.log_activity(p_event, null, 'event.cancelled', 'Event cancelled' || coalesce(': ' || nullif(left(trim(p_reason), 200), ''), ''), 'events', p_event, 'event.view');
end $$;

create or replace function public.restore_event(p_event uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event for update;
  if e.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not app.can_remove_event(p_event) then raise exception 'Only a Super Admin or a College Admin can restore events' using errcode = '42501'; end if;
  if e.status::text <> 'cancelled' then raise exception 'The event is not cancelled' using errcode = '22023'; end if;
  perform set_config('app.cancel_rpc', 'on', true);
  update public.events set status = 'planning', cancelled_at = null, cancelled_by = null, cancel_reason = null where id = p_event;
  perform set_config('app.cancel_rpc', 'off', true);
  perform app.log_activity(p_event, null, 'event.restored', 'Event restored after cancellation', 'events', p_event, 'event.view');
end $$;

create or replace function public.cancel_competition(p_competition uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare k public.event_competitions; e public.events;
begin
  select * into k from public.event_competitions where id = p_competition for update;
  if k.id is null then raise exception 'Competition not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(k.event_id, 'event.manage') then raise exception 'You are not allowed to cancel competitions here' using errcode = '42501'; end if;
  if k.cancelled_at is not null then raise exception 'The competition is already cancelled' using errcode = '22023'; end if;
  select * into e from public.events where id = k.event_id;
  update public.event_competitions set is_active = false, cancelled_at = now(), cancel_reason = nullif(left(trim(p_reason), 500), '') where id = p_competition;
  perform app.log_removal('competition', 'cancelled', k.name, k.college_id, k.event_id, e.name, p_reason);
  perform app.log_activity(k.event_id, k.department_id, 'competition.cancelled', 'Competition cancelled: ' || left(k.name, 150), 'event_competitions', k.id, 'event.view');
end $$;

create or replace function public.restore_competition(p_competition uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare k public.event_competitions;
begin
  select * into k from public.event_competitions where id = p_competition;
  if k.id is null then raise exception 'Competition not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(k.event_id, 'event.manage') then raise exception 'You are not allowed to restore competitions here' using errcode = '42501'; end if;
  update public.event_competitions set is_active = true, cancelled_at = null, cancel_reason = null where id = p_competition;
end $$;

create or replace function public.delete_competition(p_competition uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare k public.event_competitions; e public.events;
begin
  select * into k from public.event_competitions where id = p_competition for update;
  if k.id is null then raise exception 'Competition not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(k.event_id, 'event.manage') then raise exception 'You are not allowed to delete competitions here' using errcode = '42501'; end if;
  if exists (select 1 from public.registration_items where competition_id = p_competition) then
    raise exception 'People have registered for this competition, so it must be kept. Cancel it instead.' using errcode = '22023';
  end if;
  select * into e from public.events where id = k.event_id;
  perform app.log_removal('competition', 'deleted', k.name, k.college_id, k.event_id, e.name, p_reason);
  delete from public.event_competitions where id = p_competition;
  perform app.log_activity(k.event_id, null, 'competition.deleted', 'Competition deleted: ' || left(k.name, 150), 'event_competitions', k.id, 'event.view');
end $$;

-- Super Admin dashboard: clear the list of removals by other admins.
create or replace function public.clear_removal_log()
returns integer
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  if not app.is_super_admin() then raise exception 'Only the Super Admin can clear this list' using errcode = '42501'; end if;
  update public.removal_log set cleared_at = now() where cleared_at is null and not by_super_admin;
  get diagnostics v = row_count;
  return v;
end $$;

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
  perform app.log_removal('event', 'deleted', e.name, e.college_id, e.id, e.name, null);

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

do $$
declare f text;
begin
  foreach f in array array['public.cancel_event(uuid, text)', 'public.restore_event(uuid)', 'public.cancel_competition(uuid, text)',
                           'public.restore_competition(uuid)', 'public.delete_competition(uuid, text)', 'public.clear_removal_log()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
