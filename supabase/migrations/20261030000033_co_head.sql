-- ============================================================================
-- EVENT APP — Migration 33: Co-head position; Super Admin can delete assignments
-- ============================================================================
-- * A department can have several co-heads next to its one head. A co-head gets
--   the same role (powers) as the head by default. Anyone who can appoint
--   department leadership (Super Admin, College Admins, Event Admins) can add one.
-- * The Super Admin can delete a department assignment record outright
--   (revoking = ending it, which keeps history, is available to all admins).

alter type public.department_position add value if not exists 'co_head' after 'head';

-- Co-heads get the head's role for the department kind.
create or replace function app.default_department_role(p_kind public.department_kind, p_position public.department_position)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_position::text in ('head', 'co_head') then case p_kind
      when 'finance' then 'finance_head'
      when 'registration' then 'registration_head'
      when 'sponsorship' then 'sponsorship_head'
      when 'media' then 'media_head'
      when 'marketing' then 'marketing_head'
      else 'department_head' end
    when p_position::text = 'assistant_head' then 'assistant_head'
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
  if p_position::text in ('head', 'co_head', 'assistant_head') and not v_can_lead then
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

  if v_row.position::text in ('head', 'co_head', 'assistant_head') then
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

create or replace function app.check_budget_thresholds(p_department uuid, p_before numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_after numeric := app.department_budget_usage(p_department);
  v_dept public.departments;
  v_level int;
begin
  if v_after is null then return; end if;
  v_level := case when v_after >= 100 and coalesce(p_before, 0) < 100 then 100
                  when v_after >= 90 and coalesce(p_before, 0) < 90 then 90
                  when v_after >= 75 and coalesce(p_before, 0) < 75 then 75 end;
  if v_level is null then return; end if;
  select * into v_dept from public.departments where id = p_department;
  insert into public.notifications (user_id, event_id, type, title, body, link)
  select distinct m.user_id, v_dept.event_id, 'budget.threshold',
         v_dept.name || case when v_level = 100 then ' budget exceeded' else ' budget at ' || v_level || '%' end,
         round(v_after) || '% of the allocated budget is committed by approved expenses.',
         '/events/' || v_dept.event_id || '/departments/' || v_dept.id
  from public.department_members m
  where m.department_id = p_department and m.ended_at is null and m.position::text in ('head', 'co_head', 'assistant_head');
  perform app.notify_permission_holders(v_dept.event_id, 'finance.review', 'budget.threshold',
    v_dept.name || case when v_level = 100 then ' budget exceeded' else ' budget at ' || v_level || '%' end,
    round(v_after) || '% of the allocated budget is committed.', '/events/' || v_dept.event_id || '/finance?tab=budget');
  perform app.log_activity(v_dept.event_id, v_dept.id, 'budget.threshold',
    v_dept.name || ' budget reached ' || round(v_after) || '%', 'departments', v_dept.id, 'finance.view');
end $$;

-- Super Admin: delete an assignment record entirely (active or ended).
create or replace function public.delete_department_assignment(p_assignment uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.department_members; v_dept text; v_name text;
begin
  if not app.is_super_admin() then raise exception 'Only the Super Admin can delete role assignments' using errcode = '42501'; end if;
  select * into v_row from public.department_members where id = p_assignment;
  if v_row.id is null then raise exception 'Assignment not found' using errcode = 'P0002'; end if;
  select name into v_dept from public.departments where id = v_row.department_id;
  select nullif(full_name, '') into v_name from public.profiles where id = v_row.user_id;
  delete from public.department_members where id = p_assignment;
  perform app.log_activity(v_row.event_id, v_row.department_id, 'department.assignment_deleted',
    coalesce(v_name, 'A user') || '''s ' || replace(v_row.position::text, '_', '-') || ' role in ' || coalesce(v_dept, 'a department') || ' was deleted',
    'department_members', v_row.id);
end $$;

revoke execute on function public.delete_department_assignment(uuid) from public, anon;
grant execute on function public.delete_department_assignment(uuid) to authenticated, service_role;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
