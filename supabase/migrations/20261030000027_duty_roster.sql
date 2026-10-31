-- ============================================================================
-- EVENT APP — Migration 27: volunteer duty roster
-- ============================================================================
create table public.duty_shifts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  title text not null check (char_length(title) between 2 and 120),
  location text check (location is null or char_length(location) <= 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  needed int not null default 1 check (needed between 1 and 500),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index duty_shifts_event_idx on public.duty_shifts (event_id, starts_at);

create table public.duty_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.duty_shifts (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'assigned' check (status in ('assigned', 'present', 'absent')),
  marked_at timestamptz,
  marked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (shift_id, user_id)
);
create index duty_assignments_user_idx on public.duty_assignments (user_id);
create index duty_assignments_event_idx on public.duty_assignments (event_id);

alter table public.duty_shifts enable row level security;
alter table public.duty_assignments enable row level security;
create policy duty_shifts_select on public.duty_shifts for select to authenticated
  using (app.has_event_permission(event_id, 'event.view'));
create policy duty_assignments_select on public.duty_assignments for select to authenticated
  using (user_id = (select auth.uid()) or app.has_event_permission(event_id, 'event.view'));
create trigger duty_shifts_audit after insert or update or delete on public.duty_shifts for each row execute function app.audit_row();
create trigger duty_assignments_audit after insert or update or delete on public.duty_assignments for each row execute function app.audit_row();

-- Roster managers: operations managers, or leads of the shift's department.
create or replace function app.can_manage_duty(p_event uuid, p_department uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_event_permission(p_event, 'operations.manage')
      or (p_department is not null and app.has_department_permission(p_department, 'department.manage'))
$$;

create or replace function public.save_duty_shift(p_event uuid, p_shift uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.events; v_dept uuid := nullif(p_data ->> 'department_id', '')::uuid; v_id uuid; s public.duty_shifts;
begin
  select * into e from public.events where id = p_event;
  if e.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if p_shift is not null then
    select * into s from public.duty_shifts where id = p_shift and event_id = p_event;
    if s.id is null then raise exception 'Shift not found' using errcode = 'P0002'; end if;
    if not app.can_manage_duty(p_event, s.department_id) then raise exception 'You are not allowed to manage this roster' using errcode = '42501'; end if;
  end if;
  if not app.can_manage_duty(p_event, v_dept) then raise exception 'You are not allowed to manage this roster' using errcode = '42501'; end if;
  if v_dept is not null and not exists (select 1 from public.departments where id = v_dept and event_id = p_event) then
    raise exception 'Department not in this event' using errcode = '22023';
  end if;
  if p_shift is null then
    insert into public.duty_shifts (event_id, college_id, department_id, title, location, starts_at, ends_at, needed, notes, created_by)
    values (p_event, e.college_id, v_dept, trim(p_data ->> 'title'), nullif(trim(p_data ->> 'location'), ''), (p_data ->> 'starts_at')::timestamptz,
            (p_data ->> 'ends_at')::timestamptz, coalesce((p_data ->> 'needed')::int, 1), nullif(trim(p_data ->> 'notes'), ''), app.active_uid())
    returning id into v_id;
  else
    update public.duty_shifts set department_id = v_dept, title = trim(p_data ->> 'title'), location = nullif(trim(p_data ->> 'location'), ''),
           starts_at = (p_data ->> 'starts_at')::timestamptz, ends_at = (p_data ->> 'ends_at')::timestamptz,
           needed = coalesce((p_data ->> 'needed')::int, 1), notes = nullif(trim(p_data ->> 'notes'), '')
     where id = p_shift returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.remove_duty_shift(p_shift uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.duty_shifts;
begin
  select * into s from public.duty_shifts where id = p_shift;
  if s.id is null then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  if not app.can_manage_duty(s.event_id, s.department_id) then raise exception 'You are not allowed to manage this roster' using errcode = '42501'; end if;
  delete from public.duty_shifts where id = p_shift;
end $$;

create or replace function public.assign_duty(p_shift uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.duty_shifts; v_clash text;
begin
  select * into s from public.duty_shifts where id = p_shift;
  if s.id is null then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  if not app.can_manage_duty(s.event_id, s.department_id) then raise exception 'You are not allowed to manage this roster' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then raise exception 'User not found' using errcode = 'P0002'; end if;
  select o.title into v_clash from public.duty_assignments a join public.duty_shifts o on o.id = a.shift_id
   where a.user_id = p_user and o.id <> s.id and o.starts_at < s.ends_at and o.ends_at > s.starts_at limit 1;
  if v_clash is not null then raise exception 'This person is already on duty then (%)', v_clash using errcode = '22023'; end if;
  insert into public.duty_assignments (shift_id, event_id, college_id, user_id) values (s.id, s.event_id, s.college_id, p_user)
  on conflict (shift_id, user_id) do nothing;
  if found then
    perform app.notify(p_user, s.event_id, 'duty.assigned', 'Duty: ' || s.title,
      to_char(s.starts_at at time zone coalesce((select timezone from public.events where id = s.event_id), 'Asia/Kolkata'), 'DD Mon, HH24:MI') || coalesce(' · ' || s.location, ''),
      '/events/' || s.event_id || '/duty-roster');
  end if;
end $$;

create or replace function public.unassign_duty(p_assignment uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.duty_shifts;
begin
  select o.* into s from public.duty_assignments a join public.duty_shifts o on o.id = a.shift_id where a.id = p_assignment;
  if s.id is null then raise exception 'Assignment not found' using errcode = 'P0002'; end if;
  if not app.can_manage_duty(s.event_id, s.department_id) then raise exception 'You are not allowed to manage this roster' using errcode = '42501'; end if;
  delete from public.duty_assignments where id = p_assignment;
end $$;

-- Managers mark present/absent; volunteers can mark themselves present from
-- 30 minutes before the shift until it ends.
create or replace function public.mark_duty(p_assignment uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare a public.duty_assignments; s public.duty_shifts;
begin
  select * into a from public.duty_assignments where id = p_assignment;
  if a.id is null then raise exception 'Assignment not found' using errcode = 'P0002'; end if;
  select * into s from public.duty_shifts where id = a.shift_id;
  if p_status not in ('assigned', 'present', 'absent') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if not app.can_manage_duty(s.event_id, s.department_id) then
    if a.user_id <> app.active_uid() or p_status <> 'present' then
      raise exception 'You are not allowed to change this attendance' using errcode = '42501';
    end if;
    if now() < s.starts_at - interval '30 minutes' or now() > s.ends_at then
      raise exception 'You can check in from 30 minutes before your shift until it ends' using errcode = '22023';
    end if;
  end if;
  update public.duty_assignments set status = p_status, marked_at = now(), marked_by = app.active_uid() where id = p_assignment;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.save_duty_shift(uuid, uuid, jsonb)', 'public.remove_duty_shift(uuid)', 'public.assign_duty(uuid, uuid)',
                           'public.unassign_duty(uuid)', 'public.mark_duty(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Duties also appear in personal calendar feeds.
create or replace function public.calendar_feed_items(p_token text)
returns table (uid text, title text, description text, location text, starts_at timestamptz, ends_at timestamptz, all_day boolean, url text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  select f.user_id into v_uid from app.calendar_feeds f join public.profiles p on p.id = f.user_id
   where f.token = p_token and p.status = 'active';
  if v_uid is null then return; end if;
  return query
  with my_events as (
    select e.* from public.events e
    where e.status <> 'archived' and (
      exists (select 1 from public.event_members m where m.event_id = e.id and m.user_id = v_uid and m.ended_at is null and m.status = 'active')
      or exists (select 1 from public.department_members m where m.event_id = e.id and m.user_id = v_uid and m.ended_at is null and m.status = 'active')
      or exists (select 1 from public.college_members m where m.college_id = e.college_id and m.user_id = v_uid and m.ended_at is null and m.status = 'active')
    )
  )
  select 'event-' || e.id, e.name, coalesce(e.description, ''), coalesce(e.venue, ''),
         e.starts_on::timestamptz, (e.ends_on + 1)::timestamptz, true, '/events/' || e.id
  from my_events e
  union all
  select 'schedule-' || s.id, s.title || ' · ' || e.name, coalesce(s.description, ''), coalesce(s.location, ''),
         s.starts_at, coalesce(s.ends_at, s.starts_at + interval '1 hour'), false, '/events/' || e.id || '/schedule'
  from public.event_schedules s join my_events e on e.id = s.event_id
  where s.starts_at is not null
  union all
  select 'task-' || t.id, 'Task: ' || t.title, coalesce(t.description, ''), coalesce(t.location, ''),
         t.due_at - interval '30 minutes', t.due_at, false, '/events/' || t.event_id || '/tasks/' || t.id
  from public.tasks t join public.task_assignments a on a.task_id = t.id
  where a.user_id = v_uid and t.due_at is not null and t.status <> 'completed'
  union all
  select 'duty-' || d.id, 'Duty: ' || d.title, coalesce(d.notes, ''), coalesce(d.location, ''), d.starts_at, d.ends_at, false,
         '/events/' || d.event_id || '/duty-roster'
  from public.duty_shifts d join public.duty_assignments a on a.shift_id = d.id
  where a.user_id = v_uid;
end $$;
