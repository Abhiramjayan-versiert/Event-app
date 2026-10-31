-- ============================================================================
-- EVENT APP — Migration 14: Communication & documents (Phase 8)
-- ============================================================================

-- Notify the audience of a new event or department announcement.
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
  end if;
  if new.event_id is not null then
    perform app.log_activity(new.event_id, new.department_id, 'announcement.posted', 'Announcement: ' || left(new.title, 200), 'announcements', new.id);
  end if;
  return null;
end $$;
create trigger announcements_notify after insert on public.announcements
  for each row execute function app.announcement_after_insert();

-- Documents: uploader default + activity.
create or replace function app.document_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
  return new;
end $$;
create trigger documents_b_insert before insert on public.documents
  for each row execute function app.document_before_insert();

create or replace function app.document_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.log_activity(new.event_id, new.department_id, 'document.uploaded', 'Document uploaded: ' || left(new.title, 200), 'documents', new.id,
    case new.visibility when 'finance' then 'finance.view' when 'restricted' then 'event.manage' else 'event.view' end);
  return null;
end $$;
create trigger documents_activity after insert on public.documents
  for each row execute function app.document_after_insert();

-- The uploader may remove their own object only while no document record
-- references it (cleanup after a failed metadata save). Recorded documents
-- are archived, never deleted.
create policy documents_objects_delete_orphan on storage.objects for delete to authenticated using (
  bucket_id = 'documents'
  and owner = (select auth.uid())
  and not exists (select 1 from public.documents d where d.bucket = 'documents' and d.storage_path = storage.objects.name)
);

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
