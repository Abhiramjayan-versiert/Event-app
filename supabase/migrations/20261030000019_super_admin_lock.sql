-- ============================================================================
-- EVENT APP — Migration 19: a single, fixed Super Admin with a hidden identity
-- ============================================================================
-- * Super Admin access belongs only to the account whose sign-in email is
--   app.super_admin_email(). Nobody (including the service role) can grant it
--   to anyone else or remove it, and that account cannot be suspended.
-- * To everyone else the Super Admin appears as "Contact Admin": the real
--   name, phone, job title and photo live in app.super_admin_identity (the
--   private schema is not exposed through the Data API), and only the Super
--   Admin reads them back through my_access() / my_profile().

create or replace function app.super_admin_email() returns text
language sql immutable as $$ select 'abhiramjayan72@gmail.com'::text $$;

create or replace function app.is_designated_super_admin(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where u.id = p_uid and lower(u.email) = app.super_admin_email())
$$;

create table app.super_admin_identity (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  job_title text,
  avatar_path text,
  updated_at timestamptz not null default now()
);
revoke all on app.super_admin_identity from public, anon, authenticated;

create or replace function app.lock_super_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_designated boolean := app.is_designated_super_admin(new.id);
begin
  if tg_op = 'INSERT' then
    new.is_super_admin := v_designated;
  elsif new.is_super_admin is distinct from old.is_super_admin and new.is_super_admin is distinct from v_designated then
    raise exception 'Super Admin access is reserved and cannot be assigned or removed' using errcode = '42501';
  end if;

  if not v_designated then
    return new;
  end if;

  if new.status <> 'active' then
    raise exception 'The Super Admin account cannot be suspended' using errcode = '42501';
  end if;
  new.is_super_admin := true;

  -- Keep the real details privately; edits by the Super Admin land here.
  insert into app.super_admin_identity as s (user_id, email, full_name, phone, job_title, avatar_path)
  select new.id, u.email, new.full_name, new.phone, new.job_title, new.avatar_path from auth.users u where u.id = new.id
  on conflict (user_id) do update set
    email = excluded.email,
    full_name = case when tg_op = 'UPDATE' and new.full_name is not distinct from old.full_name then s.full_name else excluded.full_name end,
    phone = case when tg_op = 'UPDATE' and new.phone is not distinct from old.phone then s.phone else excluded.phone end,
    job_title = case when tg_op = 'UPDATE' and new.job_title is not distinct from old.job_title then s.job_title else excluded.job_title end,
    avatar_path = case when tg_op = 'UPDATE' and new.avatar_path is not distinct from old.avatar_path then s.avatar_path else excluded.avatar_path end,
    updated_at = now();

  new.full_name := 'Contact Admin';
  new.email := 'Contact Admin';
  new.phone := null;
  new.job_title := null;
  new.avatar_path := null;
  return new;
end $$;

-- Named to sort after profiles_guard so identity checks run first.
create trigger profiles_lock_super_admin before insert or update on public.profiles
  for each row execute function app.lock_super_admin();

-- Existing data: remember the real identity, then mask it; nobody else keeps the flag.
insert into app.super_admin_identity (user_id, email, full_name, phone, job_title, avatar_path)
select p.id, u.email, p.full_name, p.phone, p.job_title, p.avatar_path
from public.profiles p join auth.users u on u.id = p.id
where lower(u.email) = app.super_admin_email()
on conflict (user_id) do nothing;

alter table public.profiles disable trigger profiles_lock_super_admin;
update public.profiles p set is_super_admin = false where p.is_super_admin and not app.is_designated_super_admin(p.id);
alter table public.profiles enable trigger profiles_lock_super_admin;
update public.profiles p set is_super_admin = true, status = 'active' where app.is_designated_super_admin(p.id);

create or replace function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', p.id,
    -- The Super Admin sees their real identity; everyone else sees "Contact Admin".
    'email', coalesce(sa.email, p.email),
    'full_name', coalesce(sa.full_name, p.full_name),
    'avatar_path', case when sa.user_id is not null then sa.avatar_path else p.avatar_path end,
    'status', p.status,
    'is_super_admin', p.is_super_admin and p.status = 'active',
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'code', c.code, 'status', c.status, 'logo_path', c.logo_path,
        'roles', (select coalesce(jsonb_agg(distinct r.key), '[]'::jsonb)
                  from public.college_members cm join public.roles r on r.id = cm.role_id
                  where cm.college_id = c.id and cm.user_id = v_uid and cm.status = 'active' and cm.ended_at is null)
      ) order by c.name)
      from public.colleges c
      where c.id = any(app.visible_college_ids())
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'slug', e.slug, 'status', e.status, 'college_id', e.college_id,
        'college_name', c.name, 'starts_on', e.starts_on, 'ends_on', e.ends_on, 'logo_path', e.logo_path,
        'roles', (
          select coalesce(jsonb_agg(x order by x ->> 'role_name'), '[]'::jsonb) from (
            select jsonb_build_object('role_key', r.key, 'role_name', r.name, 'department_id', null,
                                      'department_name', null, 'position', null) as x
            from public.event_members em join public.roles r on r.id = em.role_id
            where em.event_id = e.id and em.user_id = v_uid and em.status = 'active' and em.ended_at is null
            union all
            select jsonb_build_object('role_key', r.key, 'role_name', r.name, 'department_id', d.id,
                                      'department_name', d.name, 'position', dm.position)
            from public.department_members dm
            join public.roles r on r.id = dm.role_id
            join public.departments d on d.id = dm.department_id
            where dm.event_id = e.id and dm.user_id = v_uid and dm.status = 'active' and dm.ended_at is null
          ) s
        )
      ) order by e.starts_on desc)
      from public.events e
      join public.colleges c on c.id = e.college_id
      where e.id = any(app.event_ids_with_permission('event.view'))
    ), '[]'::jsonb)
  ) into v_result
  from public.profiles p
  left join app.super_admin_identity sa on sa.user_id = p.id
  where p.id = v_uid;

  return v_result;
end $$;

-- Own profile details for the profile page (real values for the Super Admin).
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'full_name', coalesce(sa.full_name, p.full_name),
    'phone', case when sa.user_id is not null then sa.phone else p.phone end,
    'job_title', case when sa.user_id is not null then sa.job_title else p.job_title end,
    'avatar_path', case when sa.user_id is not null then sa.avatar_path else p.avatar_path end,
    'created_at', p.created_at
  )
  from public.profiles p
  left join app.super_admin_identity sa on sa.user_id = p.id
  where p.id = auth.uid()
$$;

revoke execute on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated, service_role;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
