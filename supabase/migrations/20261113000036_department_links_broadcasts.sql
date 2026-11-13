-- ============================================================================
-- EVENT APP — Migration 36: automatic department links, Super Admin broadcasts
-- ============================================================================
-- 1. Department links: the leadership (head, co-heads, assistant heads) of one
--    department automatically gets View or Manage access to a related
--    department. Defaults are created by department kind (Finance -> all
--    departments, Marketing <-> Media); College Admins and the Super Admin can
--    add, change and remove links per event.
-- 2. Broadcasts: an announcement posted by the Super Admin is shown to its
--    audience as a must-acknowledge pop-up inside the app, and is also sent
--    to every phone that has push switched on.

create table public.department_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  from_department_id uuid not null references public.departments (id) on delete cascade,
  to_department_id uuid references public.departments (id) on delete cascade,   -- null = every department
  access text not null default 'view' check (access in ('view', 'manage')),
  role_id uuid not null references public.roles (id) on delete restrict,
  is_default boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint department_links_not_self check (to_department_id is null or to_department_id <> from_department_id)
);
create unique index department_links_key on public.department_links (from_department_id, coalesce(to_department_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index department_links_event_idx on public.department_links (event_id);
alter table public.department_links enable row level security;
create policy department_links_select on public.department_links for select to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('event.view'))::uuid[])
);

create or replace function app.link_role(p_access text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.roles where key = case p_access when 'manage' then 'department_head' else 'department_viewer' end
$$;

-- Default links for a department, by kind.
create or replace function app.seed_department_links(p_department uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.departments;
begin
  select * into d from public.departments where id = p_department;
  if d.id is null then return; end if;
  if d.kind = 'finance' then
    insert into public.department_links (event_id, from_department_id, to_department_id, access, role_id, is_default)
    values (d.event_id, d.id, null, 'view', app.link_role('view'), true) on conflict do nothing;
  elsif d.kind in ('marketing', 'media') then
    insert into public.department_links (event_id, from_department_id, to_department_id, access, role_id, is_default)
    select d.event_id, a.id, b.id, 'view', app.link_role('view'), true
    from public.departments a join public.departments b on b.event_id = a.event_id
    where a.event_id = d.event_id and d.id in (a.id, b.id)
      and ((a.kind = 'marketing' and b.kind = 'media') or (a.kind = 'media' and b.kind = 'marketing'))
    on conflict do nothing;
  end if;
end $$;

create or replace function app.departments_seed_links() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_department_links(new.id);
  return null;
end $$;
create trigger departments_seed_links after insert on public.departments
  for each row execute function app.departments_seed_links();

-- Existing events.
select app.seed_department_links(id) from public.departments where kind in ('finance', 'marketing', 'media') and status = 'active';

-- Department-scoped permission through a link (leadership of the source department only).
create or replace function app.has_linked_department_permission(p_department uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.departments t
    join public.department_links l on l.event_id = t.event_id and (l.to_department_id = t.id or (l.to_department_id is null and l.from_department_id <> t.id))
    join public.department_members dm on dm.department_id = l.from_department_id
    join public.role_permissions rp on rp.role_id = l.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where t.id = p_department
      and dm.user_id = app.active_uid() and dm.status = 'active' and dm.ended_at is null
      and dm.position::text in ('head', 'co_head', 'assistant_head')
      and pm.key = p_perm and pm.scope = 'department'
  )
$$;

create or replace function app.has_department_permission(p_department uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_event_permission((select d.event_id from public.departments d where d.id = p_department), p_perm)
    or exists (
      select 1
      from public.department_members dm
      join public.role_permissions rp on rp.role_id = dm.role_id
      join public.permissions pm on pm.id = rp.permission_id
      where dm.department_id = p_department
        and dm.user_id = app.active_uid()
        and dm.status = 'active' and dm.ended_at is null
        and pm.key = p_perm
    )
    or exists (
      select 1
      from public.department_access_grants g
      join public.role_permissions rp on rp.role_id = g.role_id
      join public.permissions pm on pm.id = rp.permission_id
      where g.department_id = p_department
        and g.user_id = app.active_uid() and g.ended_at is null
        and pm.key = p_perm and pm.scope = 'department'
    )
    or app.has_linked_department_permission(p_department, p_perm)
$$;

-- Departments (with permission keys) the current user reaches through links.
create or replace function app.linked_department_permissions(p_event uuid default null)
returns table (department_id uuid, key text)
language sql stable security definer set search_path = '' as $$
  select distinct t.id, pm.key
  from public.department_members dm
  join public.department_links l on l.from_department_id = dm.department_id
  join public.departments t on t.event_id = l.event_id and (l.to_department_id = t.id or (l.to_department_id is null and t.id <> l.from_department_id))
  join public.role_permissions rp on rp.role_id = l.role_id
  join public.permissions pm on pm.id = rp.permission_id and pm.scope = 'department'
  where dm.user_id = app.active_uid() and dm.status = 'active' and dm.ended_at is null
    and dm.position::text in ('head', 'co_head', 'assistant_head')
    and (p_event is null or l.event_id = p_event)
$$;

create or replace function app.department_ids_with_permission(p_perm text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.department_id), '{}'::uuid[])
  from (
    select dm.department_id
    from public.department_members dm
    join public.role_permissions rp on rp.role_id = dm.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where dm.user_id = app.active_uid() and dm.status = 'active' and dm.ended_at is null and pm.key = p_perm
    union
    select g.department_id
    from public.department_access_grants g
    join public.role_permissions rp on rp.role_id = g.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where g.user_id = app.active_uid() and g.ended_at is null and pm.key = p_perm and pm.scope = 'department'
    union
    select lp.department_id from app.linked_department_permissions() lp where lp.key = p_perm
  ) x
$$;

create or replace function public.my_event_permissions(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.active_uid();
  v_event_perms text[];
  v_dept jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('event', '[]'::jsonb, 'departments', '{}'::jsonb);
  end if;

  if app.is_super_admin() then
    select array_agg(key order by key) into v_event_perms from public.permissions where scope <> 'college';
    return jsonb_build_object('event', to_jsonb(v_event_perms), 'departments', '{}'::jsonb, 'all_departments', true);
  end if;

  select coalesce(array_agg(distinct pm.key order by pm.key), '{}') into v_event_perms
  from public.permissions pm
  join public.role_permissions rp on rp.permission_id = pm.id
  where rp.role_id in (
      select cm.role_id from public.college_members cm join public.events e on e.college_id = cm.college_id
      where e.id = p_event and cm.user_id = v_uid and cm.status = 'active' and cm.ended_at is null
      union all
      select em.role_id from public.event_members em
      where em.event_id = p_event and em.user_id = v_uid and em.status = 'active' and em.ended_at is null
        and app.event_role_applies(em.event_id, em.user_id, em.all_departments)
    )
    or (pm.scope <> 'department' and rp.role_id in (
      select dm.role_id from public.department_members dm
      where dm.event_id = p_event and dm.user_id = v_uid and dm.status = 'active' and dm.ended_at is null
    ));

  select coalesce(jsonb_object_agg(x.department_id, x.perms), '{}'::jsonb) into v_dept
  from (
    select y.department_id, jsonb_agg(distinct y.key) as perms
    from (
      select dm.department_id, pm.key
      from public.department_members dm
      join public.role_permissions rp on rp.role_id = dm.role_id
      join public.permissions pm on pm.id = rp.permission_id
      where dm.event_id = p_event and dm.user_id = v_uid and dm.status = 'active' and dm.ended_at is null
      union all
      select g.department_id, pm.key
      from public.department_access_grants g
      join public.role_permissions rp on rp.role_id = g.role_id
      join public.permissions pm on pm.id = rp.permission_id
      where g.event_id = p_event and g.user_id = v_uid and g.ended_at is null and pm.scope = 'department'
      union all
      select lp.department_id, lp.key from app.linked_department_permissions(p_event) lp
    ) y
    group by y.department_id
  ) x;

  return jsonb_build_object(
    'event', to_jsonb(v_event_perms),
    'departments', v_dept,
    'all_departments', 'department.view' = any(v_event_perms)
  );
end $$;

create or replace function public.set_department_link(p_from uuid, p_to uuid, p_access text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.departments; t public.departments; v_id uuid;
begin
  select * into f from public.departments where id = p_from;
  if f.id is null then raise exception 'Department not found' using errcode = 'P0002'; end if;
  if not app.can_control_department_access(f.event_id) then
    raise exception 'Only a College Admin or the Super Admin can change department links' using errcode = '42501';
  end if;
  if p_access not in ('view', 'manage') then raise exception 'Choose View or Manage' using errcode = '22023'; end if;
  if p_to is not null then
    select * into t from public.departments where id = p_to;
    if t.id is null or t.event_id <> f.event_id then raise exception 'Choose a department of the same event' using errcode = '22023'; end if;
    if p_to = p_from then raise exception 'A department cannot be linked to itself' using errcode = '22023'; end if;
  end if;
  delete from public.department_links where from_department_id = p_from and to_department_id is not distinct from p_to;
  insert into public.department_links (event_id, from_department_id, to_department_id, access, role_id, created_by)
  values (f.event_id, p_from, p_to, p_access, app.link_role(p_access), app.active_uid())
  returning id into v_id;
  perform app.log_activity(f.event_id, f.id, 'access.department_linked',
    f.name || ' leadership can now ' || p_access || ' ' || coalesce(t.name, 'all departments'), 'department_links', v_id, 'event.members.manage');
  return v_id;
end $$;

create or replace function public.remove_department_link(p_link uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare l public.department_links;
begin
  select * into l from public.department_links where id = p_link;
  if l.id is null then raise exception 'Link not found' using errcode = 'P0002'; end if;
  if not app.can_control_department_access(l.event_id) then
    raise exception 'Only a College Admin or the Super Admin can change department links' using errcode = '42501';
  end if;
  delete from public.department_links where id = p_link;
  perform app.log_activity(l.event_id, l.from_department_id, 'access.department_unlinked',
    coalesce((select name from public.departments where id = l.from_department_id), 'A department') || ' no longer reaches '
      || coalesce((select name from public.departments where id = l.to_department_id), 'all departments'),
    'department_links', l.id, 'event.members.manage');
end $$;

-- ---------------------------------------------------------------------------
-- Broadcasts
-- ---------------------------------------------------------------------------
alter table public.announcements add column is_broadcast boolean not null default false;

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
alter table public.announcement_reads enable row level security;
create policy announcement_reads_select on public.announcement_reads for select to authenticated using (user_id = (select auth.uid()));

-- Every announcement from the Super Admin is a broadcast.
create or replace function app.announcement_mark_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.is_broadcast := coalesce((select p.is_super_admin from public.profiles p where p.id = new.created_by), false);
  return new;
end $$;
create trigger announcements_a_broadcast before insert on public.announcements
  for each row execute function app.announcement_mark_broadcast();

create or replace function app.announcement_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scope = 'event' then
    insert into public.notifications (user_id, event_id, type, title, body, link)
    select distinct u.user_id, new.event_id, 'announcement', 'Announcement: ' || left(new.title, 150), left(new.body, 300),
           '/events/' || new.event_id || '/announcements'
    from (
      select user_id from public.event_members where event_id = new.event_id and ended_at is null and status = 'active'
      union select user_id from public.department_members where event_id = new.event_id and ended_at is null and status = 'active'
    ) u
    where u.user_id is distinct from new.created_by;
  elsif new.scope = 'department' then
    insert into public.notifications (user_id, event_id, type, title, body, link)
    select distinct m.user_id, new.event_id, 'announcement', 'Announcement: ' || left(new.title, 150), left(new.body, 300),
           '/events/' || new.event_id || '/departments/' || new.department_id
    from public.department_members m
    where m.department_id = new.department_id and m.ended_at is null and m.status = 'active' and m.user_id is distinct from new.created_by;
  elsif new.is_broadcast and new.scope = 'global' then
    insert into public.notifications (user_id, type, title, body, link)
    select p.id, 'announcement', 'Announcement: ' || left(new.title, 150), left(new.body, 300), '/announcements'
    from public.profiles p
    where p.status = 'active' and p.id is distinct from new.created_by;
  elsif new.is_broadcast and new.scope = 'college' then
    insert into public.notifications (user_id, type, title, body, link)
    select distinct u.user_id, 'announcement', 'Announcement: ' || left(new.title, 150), left(new.body, 300), '/announcements'
    from (
      select user_id from public.college_members where college_id = new.college_id and ended_at is null and status = 'active'
      union select user_id from public.event_members where college_id = new.college_id and ended_at is null and status = 'active'
      union select user_id from public.department_members where college_id = new.college_id and ended_at is null and status = 'active'
    ) u
    where u.user_id is distinct from new.created_by;
  end if;
  if new.event_id is not null then
    perform app.log_activity(new.event_id, new.department_id, 'announcement.posted', 'Announcement: ' || left(new.title, 200), 'announcements', new.id);
  end if;
  return null;
end $$;

-- Broadcasts the current user can see and has not acknowledged yet.
create or replace function public.my_unread_broadcasts()
returns table (id uuid, title text, body text, priority text, published_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.title, a.body, a.priority, a.published_at
  from public.announcements a
  where a.is_broadcast
    and a.created_by is distinct from (select auth.uid())
    and a.published_at > now() - interval '30 days'
    and (a.expires_at is null or a.expires_at > now())
    and a.published_at >= (select p.created_at from public.profiles p where p.id = (select auth.uid()))
    and not exists (select 1 from public.announcement_reads r where r.announcement_id = a.id and r.user_id = (select auth.uid()))
  order by a.published_at
  limit 5
$$;

create or replace function public.ack_broadcast(p_announcement uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if app.active_uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  insert into public.announcement_reads (announcement_id, user_id)
  select a.id, app.active_uid() from public.announcements a where a.id = p_announcement and a.is_broadcast
  on conflict do nothing;
end $$;

-- Super Admin: how many people have acknowledged a broadcast.
create or replace function public.broadcast_read_count(p_announcement uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select case when app.is_super_admin() then (select count(*)::int from public.announcement_reads where announcement_id = p_announcement) end
$$;

do $$
declare f text;
begin
  foreach f in array array['public.set_department_link(uuid, uuid, text)', 'public.remove_department_link(uuid)', 'public.my_unread_broadcasts()',
                           'public.ack_broadcast(uuid)', 'public.broadcast_read_count(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
