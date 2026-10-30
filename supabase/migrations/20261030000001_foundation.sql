-- ============================================================================
-- EVENT APP — Migration 1: Foundation
-- Identity, tenancy (college → event → department), permission matrix and the
-- permission-resolution functions every RLS policy depends on.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Private schema for internal helpers. Not exposed through the Data API.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.account_status as enum ('active', 'suspended');
create type public.college_status as enum ('active', 'inactive', 'archived');
create type public.event_status as enum (
  'planning', 'registration_open', 'registration_closed', 'upcoming', 'live', 'completed', 'archived'
);
create type public.membership_status as enum ('invited', 'active', 'suspended');
create type public.role_scope as enum ('global', 'college', 'event', 'department');
create type public.permission_scope as enum ('college', 'event', 'department');
create type public.department_position as enum ('head', 'assistant_head', 'member');
create type public.department_kind as enum (
  'finance', 'registration', 'sponsorship', 'media', 'marketing', 'technical', 'logistics',
  'operations', 'hospitality', 'general'
);
create type public.record_status as enum ('active', 'archived');

-- ---------------------------------------------------------------------------
-- Generic trigger functions
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- True when the current database session is a trusted backend (service role
-- key, migrations, SQL editor) rather than an end-user request.
-- Must only be called from SECURITY INVOKER code paths.
create or replace function app.is_trusted_backend() returns boolean
language sql stable as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin')
      or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  avatar_path text,
  job_title text,
  is_super_admin boolean not null default false,
  status public.account_status not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_len check (char_length(full_name) <= 120),
  constraint profiles_phone_len check (phone is null or char_length(phone) <= 32)
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_super_admin_idx on public.profiles (id) where is_super_admin;

create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Users can never grant themselves privileges or change identity fields.
create or replace function app.guard_profile_update() returns trigger
language plpgsql as $$
begin
  if app.is_trusted_backend() then
    return new;
  end if;
  if new.id <> old.id or new.email <> old.email then
    raise exception 'Profile identity fields cannot be changed' using errcode = '42501';
  end if;
  if (new.is_super_admin <> old.is_super_admin or new.status <> old.status)
     and not app.is_super_admin() then
    raise exception 'Only a Super Admin can change account privileges or status' using errcode = '42501';
  end if;
  if new.id = auth.uid() and new.is_super_admin <> old.is_super_admin then
    raise exception 'You cannot change your own Super Admin flag' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function app.guard_profile_update();

-- New auth users get a profile. is_super_admin is never taken from metadata.
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_auth_user();

create or replace function app.handle_auth_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function app.handle_auth_user_email_change();

-- ---------------------------------------------------------------------------
-- Roles & permission matrix
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  scope public.role_scope not null,
  is_system boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_key_format check (key ~ '^[a-z][a-z0-9_]{1,62}$')
);
create trigger roles_touch before update on public.roles
  for each row execute function app.touch_updated_at();

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  module text not null,
  name text not null,
  description text not null default '',
  scope public.permission_scope not null,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  constraint permissions_key_format check (key ~ '^[a-z][a-z0-9_.]{1,80}$')
);

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);
create index role_permissions_permission_idx on public.role_permissions (permission_id);

-- ---------------------------------------------------------------------------
-- Colleges
-- ---------------------------------------------------------------------------
create table public.colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  logo_path text,
  email text,
  website text,
  address text,
  city text,
  state text,
  country text not null default 'India',
  phone text,
  description text,
  status public.college_status not null default 'active',
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint colleges_name_len check (char_length(name) between 2 and 200),
  constraint colleges_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  constraint colleges_archived_consistency check ((status = 'archived') = (archived_at is not null))
);
create unique index colleges_code_key on public.colleges (code);
create index colleges_status_idx on public.colleges (status);
create trigger colleges_touch before update on public.colleges
  for each row execute function app.touch_updated_at();

create table public.college_members (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  status public.membership_status not null default 'active',
  invited_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index college_members_active_key on public.college_members (college_id, user_id, role_id)
  where ended_at is null;
create index college_members_user_idx on public.college_members (user_id) where ended_at is null;
create trigger college_members_touch before update on public.college_members
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges (id) on delete restrict,
  name text not null,
  slug text not null,
  category text not null default 'cultural',
  description text,
  logo_path text,
  banner_path text,
  starts_on date not null,
  ends_on date not null,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  venue text,
  website_url text,
  contact_email text,
  contact_phone text,
  social_links jsonb not null default '{}'::jsonb,
  currency char(3) not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  status public.event_status not null default 'planning',
  financially_closed_at timestamptz,
  financially_closed_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_name_len check (char_length(name) between 2 and 200),
  constraint events_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  constraint events_dates check (ends_on >= starts_on),
  constraint events_registration_window check (
    registration_opens_at is null or registration_closes_at is null or registration_closes_at >= registration_opens_at
  ),
  constraint events_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint events_category_len check (char_length(category) between 2 and 60)
);
create unique index events_college_slug_key on public.events (college_id, slug);
create index events_college_idx on public.events (college_id);
create index events_status_idx on public.events (status);
create index events_starts_on_idx on public.events (starts_on);
create trigger events_touch before update on public.events
  for each row execute function app.touch_updated_at();

create or replace function app.guard_event_update() returns trigger
language plpgsql as $$
begin
  if new.college_id <> old.college_id then
    raise exception 'An event cannot be moved to another college' using errcode = '42501';
  end if;
  if new.status = 'archived' and old.status <> 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
    new.archived_by := coalesce(new.archived_by, auth.uid());
  elsif new.status <> 'archived' then
    new.archived_at := null;
    new.archived_by := null;
  end if;
  return new;
end $$;
create trigger events_guard before update on public.events
  for each row execute function app.guard_event_update();

create table public.event_settings (
  event_id uuid primary key references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete restrict,
  registration_settings jsonb not null default jsonb_build_object(
    'duplicate_rule', 'email_per_category',
    'allow_team_registrations', true,
    'max_team_size', 6,
    'custom_fields', '[]'::jsonb
  ),
  approval_limits jsonb not null default jsonb_build_object(
    'finance_review_limit', 10000,
    'requires_final_approval_above', 10000
  ),
  budget_settings jsonb not null default jsonb_build_object(
    'warning_threshold_pct', 75,
    'critical_threshold_pct', 90
  ),
  notification_settings jsonb not null default jsonb_build_object(
    'notify_on_registration', true,
    'notify_on_sponsorship_payment', true,
    'task_due_reminder_hours', 24
  ),
  branding jsonb not null default '{}'::jsonb,
  integration_mode text not null default 'sandbox',
  payment_provider text not null default 'razorpay',
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_settings_integration_mode check (integration_mode in ('sandbox', 'production'))
);
create trigger event_settings_touch before update on public.event_settings
  for each row execute function app.touch_updated_at();

create table public.event_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  status public.membership_status not null default 'active',
  invited_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index event_members_active_key on public.event_members (event_id, user_id, role_id)
  where ended_at is null;
create index event_members_user_idx on public.event_members (user_id) where ended_at is null;
create index event_members_event_idx on public.event_members (event_id);
create trigger event_members_touch before update on public.event_members
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  name text not null,
  kind public.department_kind not null default 'general',
  description text,
  icon text not null default 'layers',
  status public.record_status not null default 'active',
  progress_pct int not null default 0,
  sort_order int not null default 100,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_name_len check (char_length(name) between 2 and 80),
  constraint departments_progress check (progress_pct between 0 and 100)
);
create unique index departments_event_name_key on public.departments (event_id, lower(name));
create index departments_event_idx on public.departments (event_id);
create trigger departments_touch before update on public.departments
  for each row execute function app.touch_updated_at();

create table public.department_members (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position public.department_position not null default 'member',
  role_id uuid not null references public.roles (id) on delete restrict,
  status public.membership_status not null default 'active',
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A user holds one active position per department; one active head per department.
create unique index department_members_active_key on public.department_members (department_id, user_id)
  where ended_at is null;
create unique index department_members_one_head on public.department_members (department_id)
  where ended_at is null and position = 'head';
create index department_members_user_idx on public.department_members (user_id) where ended_at is null;
create index department_members_event_idx on public.department_members (event_id);
create trigger department_members_touch before update on public.department_members
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Scope guard: every event-scoped row derives college_id from its event and
-- any department_id must belong to the same event. Rows can never be moved
-- between events. This makes cross-tenant spoofing impossible regardless of
-- what the client sends.
-- ---------------------------------------------------------------------------
create or replace function app.scope_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := to_jsonb(new);
  v_event uuid := nullif(j ->> 'event_id', '')::uuid;
  v_college uuid;
  v_dept uuid;
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) ->> 'event_id') is distinct from (j ->> 'event_id') then
    raise exception 'Records cannot be moved between events' using errcode = '42501';
  end if;

  if v_event is null then
    return new;
  end if;

  select e.college_id into v_college from public.events e where e.id = v_event;
  if v_college is null then
    raise exception 'Event % does not exist', v_event using errcode = '23503';
  end if;

  if j ? 'department_id' and nullif(j ->> 'department_id', '') is not null then
    v_dept := (j ->> 'department_id')::uuid;
    if not exists (select 1 from public.departments d where d.id = v_dept and d.event_id = v_event) then
      raise exception 'Department does not belong to this event' using errcode = '42501';
    end if;
  end if;

  if j ? 'college_id' then
    new := jsonb_populate_record(new, jsonb_build_object('college_id', v_college));
  end if;
  return new;
end $$;

create trigger event_settings_scope before insert or update on public.event_settings
  for each row execute function app.scope_guard();
create trigger event_members_scope before insert or update on public.event_members
  for each row execute function app.scope_guard();
create trigger departments_scope before insert or update on public.departments
  for each row execute function app.scope_guard();
create trigger department_members_scope before insert or update on public.department_members
  for each row execute function app.scope_guard();

-- Department member rows must point at the department's event.
create or replace function app.guard_department_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select d.event_id into v_event from public.departments d where d.id = new.department_id;
  if v_event is null then
    raise exception 'Unknown department' using errcode = '23503';
  end if;
  new.event_id := v_event;
  if tg_op = 'UPDATE' and new.department_id <> old.department_id then
    raise exception 'Create a new assignment instead of moving one' using errcode = '42501';
  end if;
  if new.ended_at is not null and old is not null and old.ended_at is null then
    new.ended_by := coalesce(new.ended_by, auth.uid());
  end if;
  return new;
end $$;
-- Runs before scope_guard (trigger names fire alphabetically).
create trigger department_members_a_event before insert or update on public.department_members
  for each row execute function app.guard_department_member();

-- ---------------------------------------------------------------------------
-- Per-event counters for human readable numbers (REG-000001, EXP-000001 …)
-- ---------------------------------------------------------------------------
create table app.event_counters (
  event_id uuid not null references public.events (id) on delete cascade,
  counter_key text not null,
  value bigint not null default 0,
  primary key (event_id, counter_key)
);

create or replace function app.next_number(p_event uuid, p_key text, p_prefix text) returns text
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into app.event_counters (event_id, counter_key, value) values (p_event, p_key, 1)
  on conflict (event_id, counter_key) do update set value = app.event_counters.value + 1
  returning value into v;
  return p_prefix || '-' || lpad(v::text, 6, '0');
end $$;

-- ---------------------------------------------------------------------------
-- Permission resolution
--
-- Grants come from four sources:
--   1. profiles.is_super_admin → everything, everywhere.
--   2. college_members.role_id → applies to the college and all its events.
--   3. event_members.role_id   → applies to the whole event.
--   4. department_members.role_id → department-scoped permissions apply only
--      to that department; event-scoped permissions apply to the event.
-- ---------------------------------------------------------------------------
create or replace function app.active_uid() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.id = auth.uid() and p.status = 'active'
$$;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.id = auth.uid() and p.status = 'active'),
    false
  )
$$;

create or replace function app.has_college_permission(p_college uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or exists (
    select 1
    from public.college_members cm
    join public.role_permissions rp on rp.role_id = cm.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where cm.college_id = p_college
      and cm.user_id = app.active_uid()
      and cm.status = 'active' and cm.ended_at is null
      and pm.key = p_perm
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
$$;

-- Set-returning variants used inside RLS policies. They do not depend on the
-- row, so Postgres evaluates them once per statement (initplan) instead of
-- once per row — essential for tables with many rows.
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
  select coalesce(array_agg(distinct dm.department_id), '{}'::uuid[])
  from public.department_members dm
  join public.role_permissions rp on rp.role_id = dm.role_id
  join public.permissions pm on pm.id = rp.permission_id
  where dm.user_id = app.active_uid() and dm.status = 'active' and dm.ended_at is null and pm.key = p_perm
$$;

create or replace function app.college_ids_with_permission(p_perm text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct cm.college_id), '{}'::uuid[])
  from public.college_members cm
  join public.role_permissions rp on rp.role_id = cm.role_id
  join public.permissions pm on pm.id = rp.permission_id
  where cm.user_id = app.active_uid() and cm.status = 'active' and cm.ended_at is null and pm.key = p_perm
$$;

-- Colleges a user can see: explicit college membership or any event membership.
create or replace function app.visible_college_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.college_id), '{}'::uuid[])
  from (
    select cm.college_id from public.college_members cm
    where cm.user_id = app.active_uid() and cm.status = 'active' and cm.ended_at is null
    union
    select em.college_id from public.event_members em
    where em.user_id = app.active_uid() and em.status = 'active' and em.ended_at is null
    union
    select dm.college_id from public.department_members dm
    where dm.user_id = app.active_uid() and dm.status = 'active' and dm.ended_at is null
  ) x
$$;

-- People the current user works with (for names/avatars in the UI).
create or replace function app.visible_user_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  with my_events as (
    select unnest(app.event_ids_with_permission('event.view')) as event_id
  ),
  my_colleges as (
    select unnest(app.college_ids_with_permission('college.users.manage')) as college_id
  )
  select coalesce(array_agg(distinct u.user_id), '{}'::uuid[])
  from (
    select em.user_id from public.event_members em where em.event_id in (select event_id from my_events)
    union
    select dm.user_id from public.department_members dm where dm.event_id in (select event_id from my_events)
    union
    select cm.user_id from public.college_members cm
    where cm.college_id in (select college_id from my_colleges)
       or cm.college_id in (select e.college_id from public.events e where e.id in (select event_id from my_events))
  ) u
$$;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon;
