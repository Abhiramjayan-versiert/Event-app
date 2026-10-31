-- ============================================================================
-- EVENT APP — Migration 21: copy an event as a template for a new edition
-- ============================================================================
-- Copies structure, never people's data or money: departments, sponsorship
-- packages, competitions, venues, schedule, task checklist, settings and the
-- budget split. Dates shift by the gap between the two start dates.
-- Optionally the team (event roles and department appointments) comes along.

create or replace function public.clone_event(
  p_source uuid, p_name text, p_slug text, p_starts_on date, p_ends_on date, p_include_team boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.events;
  v_new uuid;
  v_shift interval;
  v_budget uuid;
  r record;
  v_dept jsonb := '{}';
  v_venue jsonb := '{}';
  v_comp jsonb := '{}';
  v_task jsonb := '{}';
  v_id uuid;
begin
  select * into s from public.events where id = p_source;
  if s.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not (app.is_super_admin() or s.college_id = any(app.college_ids_with_permission('college.events.create'))) then
    raise exception 'You are not allowed to create events in this college' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_slug), '') = '' then
    raise exception 'Enter a name and URL slug for the new event' using errcode = '22023';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'Check the new start and end dates' using errcode = '22023';
  end if;
  v_shift := make_interval(days => p_starts_on - s.starts_on);

  insert into public.events (college_id, name, slug, category, description, starts_on, ends_on, venue, website_url,
                             contact_email, contact_phone, social_links, currency, timezone, status, created_by)
  values (s.college_id, trim(p_name), lower(trim(p_slug)), s.category, s.description, p_starts_on, p_ends_on, s.venue, s.website_url,
          s.contact_email, s.contact_phone, s.social_links, s.currency, s.timezone, 'planning', app.active_uid())
  returning id into v_new;

  -- Replace the default workspace with the source's structure.
  delete from public.sponsorship_packages where event_id = v_new;
  delete from public.departments where event_id = v_new;

  update public.event_settings t
     set registration_settings = f.registration_settings, approval_limits = f.approval_limits,
         budget_settings = f.budget_settings, notification_settings = f.notification_settings, branding = f.branding
    from public.event_settings f where f.event_id = p_source and t.event_id = v_new;

  for r in select * from public.departments where event_id = p_source and status = 'active' order by sort_order loop
    insert into public.departments (event_id, college_id, name, kind, description, icon, sort_order, created_by)
    values (v_new, s.college_id, r.name, r.kind, r.description, r.icon, r.sort_order, app.active_uid())
    returning id into v_id;
    v_dept := v_dept || jsonb_build_object(r.id::text, v_id);
  end loop;

  insert into public.sponsorship_packages (event_id, college_id, name, tier_order, amount, description, benefits, max_slots, is_custom, is_active)
  select v_new, s.college_id, name, tier_order, amount, description, benefits, max_slots, is_custom, is_active
  from public.sponsorship_packages where event_id = p_source;

  for r in select * from public.venues where event_id = p_source and status = 'active' loop
    insert into public.venues (event_id, college_id, name, location, capacity, facilities, contact_person, contact_phone, notes)
    values (v_new, s.college_id, r.name, r.location, r.capacity, r.facilities, r.contact_person, r.contact_phone, r.notes)
    returning id into v_id;
    v_venue := v_venue || jsonb_build_object(r.id::text, v_id);
  end loop;

  for r in select * from public.event_competitions where event_id = p_source and is_active loop
    insert into public.event_competitions (event_id, college_id, department_id, name, code, category, description, fee,
                                           registration_type, team_min, team_max, capacity, starts_at, ends_at, venue, rules_url)
    values (v_new, s.college_id, (v_dept ->> r.department_id::text)::uuid, r.name, r.code, r.category, r.description, r.fee,
            r.registration_type, r.team_min, r.team_max, r.capacity, r.starts_at + v_shift, r.ends_at + v_shift, r.venue, r.rules_url)
    returning id into v_id;
    v_comp := v_comp || jsonb_build_object(r.id::text, v_id);
  end loop;

  insert into public.event_schedules (event_id, college_id, department_id, venue_id, competition_id, title, description, item_type,
                                      starts_at, ends_at, location, assigned_team, is_public, created_by)
  select v_new, s.college_id, (v_dept ->> department_id::text)::uuid, (v_venue ->> venue_id::text)::uuid, (v_comp ->> competition_id::text)::uuid,
         title, description, item_type, starts_at + v_shift, ends_at + v_shift, location, assigned_team, is_public, app.active_uid()
  from public.event_schedules where event_id = p_source;

  -- Task checklist: parents first, then subtasks, all reset to "not started".
  for r in select * from public.tasks where event_id = p_source order by parent_task_id nulls first, created_at loop
    insert into public.tasks (event_id, college_id, department_id, parent_task_id, module, task_type, title, description,
                              priority, start_at, due_at, location, notes, created_by)
    values (v_new, s.college_id, (v_dept ->> r.department_id::text)::uuid, (v_task ->> r.parent_task_id::text)::uuid, r.module,
            r.task_type, r.title, r.description, r.priority, r.start_at + v_shift, r.due_at + v_shift, r.location, r.notes, app.active_uid())
    returning id into v_id;
    v_task := v_task || jsonb_build_object(r.id::text, v_id);
  end loop;

  select id into v_budget from public.budgets where event_id = v_new;
  update public.budgets set total_amount = (select total_amount from public.budgets where event_id = p_source), notes = 'Copied from ' || s.name
   where id = v_budget;
  insert into public.budget_allocations (event_id, college_id, budget_id, department_id, allocated_amount, notes, set_by)
  select v_new, s.college_id, v_budget, (v_dept ->> a.department_id::text)::uuid, a.allocated_amount, a.notes, app.active_uid()
  from public.budget_allocations a where a.event_id = p_source and v_dept ? a.department_id::text;

  if p_include_team then
    insert into public.event_members (event_id, college_id, user_id, role_id, invited_by)
    select v_new, s.college_id, m.user_id, m.role_id, app.active_uid()
    from public.event_members m where m.event_id = p_source and m.ended_at is null and m.status = 'active'
    on conflict do nothing;
    insert into public.department_members (department_id, event_id, college_id, user_id, position, role_id, assigned_by)
    select (v_dept ->> m.department_id::text)::uuid, v_new, s.college_id, m.user_id, m.position, m.role_id, app.active_uid()
    from public.department_members m where m.event_id = p_source and m.ended_at is null and m.status = 'active' and v_dept ? m.department_id::text
    on conflict do nothing;
  end if;

  perform app.log_activity(v_new, null, 'event.cloned', 'Event created as a copy of "' || left(s.name, 150) || '"', 'events', v_new);
  return v_new;
end $$;

revoke execute on function public.clone_event(uuid, text, text, date, date, boolean) from public, anon;
grant execute on function public.clone_event(uuid, text, text, date, date, boolean) to authenticated, service_role;
