-- ============================================================================
-- EVENT APP — Migration 34: department access control
-- ============================================================================
-- * An Event Admin who also holds a position in one of the event's departments
--   is confined to that department: their Event Admin role does not apply
--   until a College Admin or the Super Admin switches on "All departments".
-- * College Admins and the Super Admin can give a person View or Manage access
--   to other specific departments (department_access_grants).
-- Event-wide powers that come with a department head role (e.g. Finance Head's
-- finance.view across the event) are unchanged.

alter table public.event_members add column all_departments boolean not null default false;

-- View-only department role used for access grants.
insert into public.roles (key, name, scope, is_system, sort_order, description) values
  ('department_viewer', 'Department Viewer', 'department', true, 55, 'Can see a department''s workspace, tasks, budget and documents')
on conflict (key) do nothing;
select app.grant_permissions('department_viewer', array['department.view', 'tasks.view', 'expenses.view', 'budgets.view', 'documents.view']);

create table public.department_access_grants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  access text not null check (access in ('view', 'manage')),
  role_id uuid not null references public.roles (id) on delete restrict,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null
);
create unique index department_access_grants_active_key on public.department_access_grants (department_id, user_id) where ended_at is null;
create index department_access_grants_user_idx on public.department_access_grants (user_id, event_id) where ended_at is null;
alter table public.department_access_grants enable row level security;
create policy department_access_grants_select on public.department_access_grants for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_super_admin())
  or college_id = any((select app.college_ids_with_permission('college.manage'))::uuid[])
);

-- True when an Event Admin membership counts: the person is not placed in a
-- department of that event, or has been given access to all departments.
create or replace function app.event_role_applies(p_event uuid, p_user uuid, p_all boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_all or not exists (
    select 1 from public.department_members d
    where d.event_id = p_event and d.user_id = p_user and d.status = 'active' and d.ended_at is null
  )
$$;

create or replace function app.has_event_permission(p_event uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or exists (
    select 1
    from public.permissions pm
    join public.role_permissions rp on rp.permission_id = pm.id
    where pm.key = p_perm
      and rp.role_id in (
        select cm.role_id
        from public.college_members cm
        join public.events e on e.college_id = cm.college_id
        where e.id = p_event and cm.user_id = app.active_uid()
          and cm.status = 'active' and cm.ended_at is null
        union all
        select em.role_id
        from public.event_members em
        where em.event_id = p_event and em.user_id = app.active_uid()
          and em.status = 'active' and em.ended_at is null
          and app.event_role_applies(em.event_id, em.user_id, em.all_departments)
        union all
        select dm.role_id
        from public.department_members dm
        where dm.event_id = p_event and dm.user_id = app.active_uid()
          and dm.status = 'active' and dm.ended_at is null
          and pm.scope <> 'department'
      )
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
$$;

create or replace function app.event_ids_with_permission(p_perm text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.event_id), '{}'::uuid[])
  from (
    select e.id as event_id
    from public.college_members cm
    join public.events e on e.college_id = cm.college_id
    join public.role_permissions rp on rp.role_id = cm.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where cm.user_id = app.active_uid() and cm.status = 'active' and cm.ended_at is null and pm.key = p_perm
    union
    select em.event_id
    from public.event_members em
    join public.role_permissions rp on rp.role_id = em.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where em.user_id = app.active_uid() and em.status = 'active' and em.ended_at is null and pm.key = p_perm
      and app.event_role_applies(em.event_id, em.user_id, em.all_departments)
    union
    select dm.event_id
    from public.department_members dm
    join public.role_permissions rp on rp.role_id = dm.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where dm.user_id = app.active_uid() and dm.status = 'active' and dm.ended_at is null
      and pm.key = p_perm and pm.scope <> 'department'
  ) x
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
    ) y
    group by y.department_id
  ) x;

  return jsonb_build_object(
    'event', to_jsonb(v_event_perms),
    'departments', v_dept,
    'all_departments', 'department.view' = any(v_event_perms)
  );
end $$;

create or replace function app.notify_permission_holders(
  p_event uuid, p_perm text, p_type text, p_title text, p_body text default null, p_link text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, event_id, type, title, body, link)
  select distinct u.user_id, p_event, p_type, left(p_title, 200), p_body, p_link
  from (
    select em.user_id, em.role_id from public.event_members em
    where em.event_id = p_event and em.status = 'active' and em.ended_at is null
      and app.event_role_applies(em.event_id, em.user_id, em.all_departments)
    union all
    select dm.user_id, dm.role_id from public.department_members dm
    where dm.event_id = p_event and dm.status = 'active' and dm.ended_at is null
  ) u
  join public.role_permissions rp on rp.role_id = u.role_id
  join public.permissions pm on pm.id = rp.permission_id and pm.key = p_perm
  where u.user_id is distinct from auth.uid();
end $$;

-- Only College Admins and the Super Admin decide who sees all departments.
create or replace function app.event_members_guard_all_departments() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.all_departments is distinct from (case when tg_op = 'INSERT' then false else old.all_departments end)
     and not app.is_trusted_backend()
     and not (app.is_super_admin() or app.has_college_permission(new.college_id, 'college.manage')) then
    raise exception 'Only a College Admin or the Super Admin can grant access to all departments' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger event_members_guard_all_departments before insert or update on public.event_members
  for each row execute function app.event_members_guard_all_departments();

create or replace function app.can_control_department_access(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or exists (
    select 1 from public.events e where e.id = p_event and e.college_id = any(app.college_ids_with_permission('college.manage'))
  )
$$;

create or replace function public.set_all_departments_access(p_event uuid, p_user uuid, p_all boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_n int; v_name text;
begin
  if not app.can_control_department_access(p_event) then
    raise exception 'Only a College Admin or the Super Admin can change department access' using errcode = '42501';
  end if;
  update public.event_members set all_departments = coalesce(p_all, false)
   where event_id = p_event and user_id = p_user and ended_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'This person has no event role here' using errcode = 'P0002'; end if;
  select coalesce(nullif(full_name, ''), 'A user') into v_name from public.profiles where id = p_user;
  perform app.log_activity(p_event, null, 'access.all_departments',
    v_name || case when p_all then ' was given access to all departments' else ' was limited to their own department' end,
    'event_members', null, 'event.members.manage');
end $$;

create or replace function public.grant_department_access(p_department uuid, p_user uuid, p_access text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.departments; v_role uuid; v_id uuid; v_name text;
begin
  select * into d from public.departments where id = p_department;
  if d.id is null then raise exception 'Department not found' using errcode = 'P0002'; end if;
  if not app.can_control_department_access(d.event_id) then
    raise exception 'Only a College Admin or the Super Admin can give department access' using errcode = '42501';
  end if;
  if p_access not in ('view', 'manage') then raise exception 'Choose View or Manage' using errcode = '22023'; end if;
  select nullif(full_name, '') into v_name from public.profiles where id = p_user and status = 'active';
  if not found then raise exception 'User not found or suspended' using errcode = 'P0002'; end if;
  select id into v_role from public.roles where key = case p_access when 'view' then 'department_viewer' else 'department_head' end;
  update public.department_access_grants set ended_at = now(), ended_by = app.active_uid()
   where department_id = p_department and user_id = p_user and ended_at is null;
  insert into public.department_access_grants (event_id, college_id, department_id, user_id, access, role_id, granted_by)
  values (d.event_id, d.college_id, d.id, p_user, p_access, v_role, app.active_uid())
  returning id into v_id;
  perform app.log_activity(d.event_id, d.id, 'access.department_granted',
    coalesce(v_name, 'A user') || ' can now ' || p_access || ' ' || d.name, 'department_access_grants', v_id, 'event.members.manage');
  perform app.notify(p_user, d.event_id, 'access.department_granted', 'You can now ' || p_access || ' ' || d.name, null,
    '/events/' || d.event_id || '/departments/' || d.id);
  return v_id;
end $$;

create or replace function public.revoke_department_access(p_grant uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare g public.department_access_grants; v_dept text;
begin
  select * into g from public.department_access_grants where id = p_grant and ended_at is null;
  if g.id is null then raise exception 'Access not found or already removed' using errcode = 'P0002'; end if;
  if not app.can_control_department_access(g.event_id) then
    raise exception 'Only a College Admin or the Super Admin can remove department access' using errcode = '42501';
  end if;
  update public.department_access_grants set ended_at = now(), ended_by = app.active_uid() where id = p_grant;
  select name into v_dept from public.departments where id = g.department_id;
  perform app.log_activity(g.event_id, g.department_id, 'access.department_revoked',
    coalesce((select nullif(full_name, '') from public.profiles where id = g.user_id), 'A user') || ' no longer has access to ' || coalesce(v_dept, 'a department'),
    'department_access_grants', g.id, 'event.members.manage');
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.set_all_departments_access(uuid, uuid, boolean)', 'public.grant_department_access(uuid, uuid, text)', 'public.revoke_department_access(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
