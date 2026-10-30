-- ============================================================================
-- EVENT APP — Migration 9: Department & team management (Phase 3)
--
-- Appointments run through SECURITY DEFINER functions so that the related
-- writes (ending the previous head, ending the user's previous position,
-- activity, notification) happen atomically, with explicit permission checks.
-- History is preserved: assignments are ended, never deleted.
-- ============================================================================

-- Default role for a position in a department of a given kind.
create or replace function app.default_department_role(p_kind public.department_kind, p_position public.department_position)
returns text
language sql immutable set search_path = '' as $$
  select case p_position
    when 'head' then case p_kind
      when 'finance' then 'finance_head'
      when 'registration' then 'registration_head'
      when 'sponsorship' then 'sponsorship_head'
      when 'media' then 'media_head'
      when 'marketing' then 'marketing_head'
      else 'department_head' end
    when 'assistant_head' then 'assistant_head'
    else 'team_member'
  end
$$;

create or replace function public.assign_department_member(
  p_department uuid,
  p_user uuid,
  p_position public.department_position,
  p_role_key text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.active_uid();
  v_dept public.departments;
  v_can_lead boolean;
  v_role_key text;
  v_role public.roles;
  v_name text;
  v_id uuid;
begin
  select * into v_dept from public.departments where id = p_department;
  if v_dept.id is null then
    raise exception 'Department not found' using errcode = 'P0002';
  end if;

  v_can_lead := app.has_event_permission(v_dept.event_id, 'departments.manage');
  if p_position in ('head', 'assistant_head') and not v_can_lead then
    raise exception 'You are not allowed to appoint department leadership' using errcode = '42501';
  end if;
  if p_position = 'member' and not app.has_department_permission(p_department, 'department.members.manage') then
    raise exception 'You are not allowed to add members to this department' using errcode = '42501';
  end if;

  v_role_key := coalesce(nullif(p_role_key, ''), app.default_department_role(v_dept.kind, p_position));
  -- Without departments.manage a person may only add plain team members:
  -- this prevents a head from granting someone e.g. Finance Head powers.
  if not v_can_lead and v_role_key <> 'team_member' then
    raise exception 'Only event administrators can assign that role' using errcode = '42501';
  end if;
  select * into v_role from public.roles where key = v_role_key and scope = 'department';
  if v_role.id is null then
    raise exception 'Unknown department role %', v_role_key using errcode = '22023';
  end if;

  select p.full_name into v_name from public.profiles p where p.id = p_user and p.status = 'active';
  if not found then
    raise exception 'User not found or suspended' using errcode = 'P0002';
  end if;

  -- One active position per person per department.
  update public.department_members
     set ended_at = now(), ended_by = v_actor, end_reason = 'Reassigned'
   where department_id = p_department and user_id = p_user and ended_at is null;

  -- One active head per department: replacing a head ends the old appointment.
  if p_position = 'head' then
    update public.department_members
       set ended_at = now(), ended_by = v_actor, end_reason = 'Replaced as head'
     where department_id = p_department and position = 'head' and ended_at is null;
  end if;

  insert into public.department_members (department_id, event_id, college_id, user_id, position, role_id, assigned_by)
  values (p_department, v_dept.event_id, v_dept.college_id, p_user, p_position, v_role.id, v_actor)
  returning id into v_id;

  perform app.log_activity(v_dept.event_id, p_department, 'department.assignment',
    coalesce(nullif(v_name, ''), 'A user') || ' joined ' || v_dept.name || ' as ' || v_role.name,
    'department_members', v_id);
  if p_user is distinct from v_actor then
    perform app.notify(p_user, v_dept.event_id, 'department.assignment',
      'You were added to ' || v_dept.name, 'Role: ' || v_role.name,
      '/events/' || v_dept.event_id || '/departments/' || v_dept.id);
  end if;
  return v_id;
end $$;

create or replace function public.end_department_assignment(p_assignment uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.department_members;
  v_dept public.departments;
begin
  select * into v_row from public.department_members where id = p_assignment;
  if v_row.id is null or v_row.ended_at is not null then
    raise exception 'Assignment not found or already ended' using errcode = 'P0002';
  end if;
  select * into v_dept from public.departments where id = v_row.department_id;

  if v_row.position in ('head', 'assistant_head') then
    if not app.has_event_permission(v_row.event_id, 'departments.manage') then
      raise exception 'You are not allowed to remove department leadership' using errcode = '42501';
    end if;
  elsif not app.has_department_permission(v_row.department_id, 'department.members.manage') then
    raise exception 'You are not allowed to remove members from this department' using errcode = '42501';
  end if;

  update public.department_members
     set ended_at = now(), ended_by = app.active_uid(), end_reason = coalesce(nullif(left(p_reason, 300), ''), 'Removed')
   where id = p_assignment;

  perform app.log_activity(v_row.event_id, v_row.department_id, 'department.removal',
    coalesce((select nullif(full_name, '') from public.profiles where id = v_row.user_id), 'A user') || ' left ' || v_dept.name,
    'department_members', v_row.id);
end $$;

-- Ends every membership a user holds in an event and unassigns their open tasks.
create or replace function public.remove_user_from_event(p_event uuid, p_user uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.active_uid();
  v_reason text := coalesce(nullif(left(p_reason, 300), ''), 'Removed from event');
begin
  if not app.has_event_permission(p_event, 'event.members.manage') then
    raise exception 'You are not allowed to remove people from this event' using errcode = '42501';
  end if;
  if p_user = v_actor then
    raise exception 'You cannot remove yourself from an event' using errcode = '42501';
  end if;

  update public.event_members set ended_at = now(), ended_by = v_actor, end_reason = v_reason
   where event_id = p_event and user_id = p_user and ended_at is null;
  update public.department_members set ended_at = now(), ended_by = v_actor, end_reason = v_reason
   where event_id = p_event and user_id = p_user and ended_at is null;
  update public.task_assignments set unassigned_at = now()
   where event_id = p_event and user_id = p_user and unassigned_at is null;

  perform app.log_activity(p_event, null, 'event.member_removed',
    coalesce((select nullif(full_name, '') from public.profiles where id = p_user), 'A user') || ' was removed from the event',
    'profiles', p_user);
end $$;

-- Assigns an event-level role (Event Admin, Event Observer or a custom event role).
create or replace function public.assign_event_role(p_event uuid, p_user uuid, p_role_key text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.roles;
  v_id uuid;
begin
  if not app.has_event_permission(p_event, 'event.members.manage') then
    raise exception 'You are not allowed to manage the event team' using errcode = '42501';
  end if;
  select * into v_role from public.roles where key = p_role_key and scope = 'event';
  if v_role.id is null then
    raise exception 'Unknown event role %', p_role_key using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then
    raise exception 'User not found or suspended' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.event_members where event_id = p_event and user_id = p_user and role_id = v_role.id and ended_at is null) then
    raise exception 'This person already has that role' using errcode = '23505';
  end if;

  insert into public.event_members (event_id, college_id, user_id, role_id, invited_by)
  select p_event, e.college_id, p_user, v_role.id, app.active_uid() from public.events e where e.id = p_event
  returning id into v_id;

  perform app.log_activity(p_event, null, 'event.member_added',
    coalesce((select nullif(full_name, '') from public.profiles where id = p_user), 'A user') || ' joined as ' || v_role.name,
    'event_members', v_id);
  perform app.notify(p_user, p_event, 'event.assignment', 'You were added to an event', 'Role: ' || v_role.name, '/events/' || p_event);
  return v_id;
end $$;

-- One row per department with leadership, headcount, task and budget figures.
-- Budget figures are included only for users who may see them.
create or replace function public.event_departments_overview(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fin boolean;
begin
  if not app.has_event_permission(p_event, 'event.view') then
    raise exception 'Not authorized to view this event' using errcode = '42501';
  end if;
  v_fin := app.has_event_permission(p_event, 'finance.view') or app.has_event_permission(p_event, 'budgets.manage');

  return coalesce((
    select jsonb_agg(row_to_json(s)::jsonb order by s.sort_order, s.name)
    from (
      select d.id, d.name, d.kind, d.icon, d.status, d.description, d.progress_pct, d.sort_order,
        (select jsonb_build_object('user_id', p.id, 'name', p.full_name, 'email', p.email, 'avatar_path', p.avatar_path)
           from public.department_members m join public.profiles p on p.id = m.user_id
          where m.department_id = d.id and m.position = 'head' and m.ended_at is null limit 1) as head,
        (select count(*) from public.department_members m where m.department_id = d.id and m.ended_at is null) as members,
        (select count(*) from public.tasks t where t.department_id = d.id and t.parent_task_id is null) as tasks_total,
        (select count(*) from public.tasks t where t.department_id = d.id and t.parent_task_id is null and t.status = 'completed') as tasks_completed,
        (select count(*) from public.tasks t where t.department_id = d.id and t.parent_task_id is null and t.status <> 'completed' and t.due_at < now()) as tasks_overdue,
        case when v_fin or app.has_department_permission(d.id, 'budgets.view') then jsonb_build_object(
          'allocated', coalesce((select a.allocated_amount from public.budget_allocations a where a.department_id = d.id), 0),
          'approved', coalesce((select sum(coalesce(r.approved_amount, 0)) from public.expense_requests r
                                 where r.department_id = d.id and r.status in ('approved', 'partially_paid', 'paid')), 0),
          'paid', coalesce((select sum(r.paid_amount) from public.expense_requests r where r.department_id = d.id), 0)
        ) end as budget,
        app.has_department_permission(d.id, 'department.view') as can_open
      from public.departments d
      where d.event_id = p_event
    ) s
  ), '[]'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.assign_department_member(uuid, uuid, public.department_position, text)',
    'public.end_department_assignment(uuid, text)',
    'public.remove_user_from_event(uuid, uuid, text)',
    'public.assign_event_role(uuid, uuid, text)',
    'public.event_departments_overview(uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on function app.default_department_role(public.department_kind, public.department_position) from public, anon;
grant execute on function app.default_department_role(public.department_kind, public.department_position) to authenticated, service_role;

-- Departments can be created by event admins; log it in the activity feed.
create or replace function app.departments_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Skip the 18 defaults created by the workspace bootstrap.
  if exists (select 1 from public.activity_log a where a.event_id = new.event_id and a.activity_type = 'event.created')
     and new.created_by is not null and new.created_by = auth.uid() then
    perform app.log_activity(new.event_id, new.id, 'department.created', 'Department "' || new.name || '" was created', 'departments', new.id);
  end if;
  return new;
end $$;
create trigger departments_activity after insert on public.departments
  for each row execute function app.departments_after_insert();

create or replace function app.departments_set_creator() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger departments_a_creator before insert on public.departments
  for each row execute function app.departments_set_creator();
