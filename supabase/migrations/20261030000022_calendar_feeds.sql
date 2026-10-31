-- ============================================================================
-- EVENT APP — Migration 22: personal calendar feeds (ICS)
-- ============================================================================
-- Each user can create a secret feed URL for Google/Apple/Outlook calendars.
-- The feed is served by /api/calendar/<token> with the service role, which
-- calls calendar_feed_items(); the token is the only credential, so it is
-- long, random and can be reset at any time.

create table app.calendar_feeds (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
revoke all on app.calendar_feeds from public, anon, authenticated;

create or replace function public.my_calendar_token(p_reset boolean default false)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.active_uid(); v_token text;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_reset then delete from app.calendar_feeds where user_id = v_uid; end if;
  select token into v_token from app.calendar_feeds where user_id = v_uid;
  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    insert into app.calendar_feeds (user_id, token) values (v_uid, v_token);
  end if;
  return v_token;
end $$;

-- Items for the feed: events the person works on, those events' schedule,
-- and tasks assigned to them. Service role only.
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
  where a.user_id = v_uid and t.due_at is not null and t.status <> 'completed';
end $$;

revoke execute on function public.my_calendar_token(boolean) from public, anon;
grant execute on function public.my_calendar_token(boolean) to authenticated;
revoke execute on function public.calendar_feed_items(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_items(text) to service_role;
