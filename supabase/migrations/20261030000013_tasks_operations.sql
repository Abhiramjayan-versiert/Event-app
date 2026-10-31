-- ============================================================================
-- EVENT APP — Migration 13: Tasks & operations automation (Phase 7)
-- ============================================================================

alter table public.tasks add column reminded_at timestamptz;
alter table public.tasks add column overdue_notified_at timestamptz;

-- Notify people when they are assigned a task.
create or replace function app.task_assignment_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  if new.user_id is distinct from auth.uid() then
    perform app.notify(new.user_id, t.event_id, 'task.assigned', 'New task: ' || t.title,
      coalesce('Due ' || to_char(t.due_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'), 'No due date'),
      '/events/' || t.event_id || '/tasks/' || t.id);
  end if;
  perform app.log_activity(t.event_id, t.department_id, 'task.assigned',
    coalesce((select nullif(full_name, '') from public.profiles where id = new.user_id), 'Someone') || ' assigned to "' || t.title || '"',
    'tasks', t.id);
  return null;
end $$;
create trigger task_assignments_notify after insert on public.task_assignments
  for each row execute function app.task_assignment_after_insert();

create or replace function app.task_assignment_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.assigned_by := coalesce(new.assigned_by, auth.uid());
  return new;
end $$;
create trigger task_assignments_b_defaults before insert on public.task_assignments
  for each row execute function app.task_assignment_defaults();

-- Activity on creation and completion; tell the creator when it is done.
create or replace function app.task_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.parent_task_id is null then
      perform app.log_activity(new.event_id, new.department_id, 'task.created', 'Task created: "' || new.title || '"', 'tasks', new.id);
    end if;
  elsif new.status = 'completed' and old.status <> 'completed' then
    perform app.log_activity(new.event_id, new.department_id, 'task.completed', 'Task completed: "' || new.title || '"', 'tasks', new.id);
    if new.created_by is distinct from auth.uid() then
      perform app.notify(new.created_by, new.event_id, 'task.completed', 'Task completed: ' || new.title, null,
        '/events/' || new.event_id || '/tasks/' || new.id);
    end if;
  elsif new.status is distinct from old.status then
    insert into public.notifications (user_id, event_id, type, title, body, link)
    select a.user_id, new.event_id, 'task.updated', 'Task updated: ' || new.title, 'Status: ' || replace(new.status::text, '_', ' '),
           '/events/' || new.event_id || '/tasks/' || new.id
    from public.task_assignments a
    where a.task_id = new.id and a.unassigned_at is null and a.user_id is distinct from auth.uid();
  end if;
  return null;
end $$;
create trigger tasks_activity after insert or update on public.tasks
  for each row execute function app.task_after_write();

-- Daily reminders: due within 24 hours, and overdue (each sent once).
create or replace function app.send_task_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare v int := 0;
begin
  with due as (
    update public.tasks t set reminded_at = now()
     where t.status <> 'completed' and t.reminded_at is null and t.due_at between now() and now() + interval '24 hours'
    returning t.*
  )
  insert into public.notifications (user_id, event_id, type, title, body, link)
  select a.user_id, d.event_id, 'task.due_soon', 'Due soon: ' || d.title, 'Due within 24 hours', '/events/' || d.event_id || '/tasks/' || d.id
  from due d join public.task_assignments a on a.task_id = d.id and a.unassigned_at is null;
  get diagnostics v = row_count;

  with late as (
    update public.tasks t set overdue_notified_at = now()
     where t.status <> 'completed' and t.overdue_notified_at is null and t.due_at < now()
    returning t.*
  )
  insert into public.notifications (user_id, event_id, type, title, body, link)
  select distinct u.user_id, l.event_id, 'task.overdue', 'Overdue: ' || l.title, 'This task is past its due date', '/events/' || l.event_id || '/tasks/' || l.id
  from late l
  join lateral (
    select a.user_id from public.task_assignments a where a.task_id = l.id and a.unassigned_at is null
    union select l.created_by where l.created_by is not null
  ) u on true;
  return v;
end $$;

-- Schedule the reminders where pg_cron is available (Supabase); no-op elsewhere.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('event-app-task-reminders', '*/30 * * * *', 'select app.send_task_reminders()');
  end if;
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- Media asset approval stamps.
create or replace function app.media_asset_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.uploaded_by := coalesce(new.uploaded_by, auth.uid()); end if;
  if new.status in ('approved', 'published') and (tg_op = 'INSERT' or old.status not in ('approved', 'published')) then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end $$;
create trigger media_assets_b_write before insert or update on public.media_assets
  for each row execute function app.media_asset_before_write();

create or replace function app.set_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger event_schedules_b_creator before insert on public.event_schedules for each row execute function app.set_created_by();
create trigger vendors_b_creator before insert on public.vendors for each row execute function app.set_created_by();

-- Department members may maintain their department's schedule items, vendors
-- and inventory (operations.update) — already covered by RLS. Marketing
-- campaigns may be deleted by marketing managers; venues already allow it.
create policy marketing_campaigns_delete on public.marketing_campaigns for delete to authenticated using (
  (select app.is_super_admin()) or event_id = any((select app.event_ids_with_permission('marketing.manage'))::uuid[])
);

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
