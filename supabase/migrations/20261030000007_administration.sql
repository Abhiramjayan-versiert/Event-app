-- ============================================================================
-- EVENT APP — Migration 7: Administration helpers (Phase 2)
-- ============================================================================

-- Lets server actions verify a permission for the current user *before*
-- performing privileged work (e.g. sending an invitation with the service role).
create or replace function public.check_permission(p_scope text, p_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_scope
    when 'global' then app.is_super_admin()
    when 'college' then app.has_college_permission(p_id, p_permission)
    when 'event' then app.has_event_permission(p_id, p_permission)
    when 'department' then app.has_department_permission(p_id, p_permission)
    else false
  end
$$;
revoke execute on function public.check_permission(text, uuid, text) from anon;

-- Archive bookkeeping for colleges (mirrors events).
create or replace function app.guard_college_update() returns trigger
language plpgsql as $$
begin
  new.code := upper(new.code);
  if tg_op = 'UPDATE' and new.status = 'archived' and old.status <> 'archived' then
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif new.status <> 'archived' then
    new.archived_at := null;
    new.archived_by := null;
  elsif tg_op = 'INSERT' then
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  return new;
end $$;
create trigger colleges_guard before insert or update on public.colleges
  for each row execute function app.guard_college_update();

create or replace function app.events_set_creator() returns trigger
language plpgsql as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger events_a_creator before insert on public.events
  for each row execute function app.events_set_creator();

-- Membership history: stamp who ended a membership.
create or replace function app.stamp_membership_end() returns trigger
language plpgsql as $$
begin
  if new.ended_at is not null and old.ended_at is null then
    new.ended_by := coalesce(new.ended_by, auth.uid());
  end if;
  return new;
end $$;
create trigger college_members_end before update on public.college_members
  for each row execute function app.stamp_membership_end();
create trigger event_members_end before update on public.event_members
  for each row execute function app.stamp_membership_end();
