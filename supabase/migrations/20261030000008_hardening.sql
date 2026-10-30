-- ============================================================================
-- EVENT APP — Migration 8: Hardening (Supabase security advisor findings)
-- ============================================================================

-- Postgres grants EXECUTE to PUBLIC by default; revoking from anon alone is
-- not enough. Application RPCs are for signed-in users only.
do $$
declare f text;
begin
  foreach f in array array[
    'public.my_access()',
    'public.my_event_permissions(uuid)',
    'public.global_dashboard(uuid, uuid, public.event_status, date, date)',
    'public.event_dashboard(uuid, date, date)',
    'public.event_financial_summary(uuid, date, date)',
    'public.check_permission(text, uuid, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
alter default privileges in schema app revoke execute on functions from public;

-- Pin search_path on every helper that did not set it.
alter function app.is_trusted_backend() set search_path = '';
alter function app.guard_profile_update() set search_path = '';
alter function app.touch_updated_at() set search_path = '';
alter function app.guard_event_update() set search_path = '';
alter function app.task_completion_stamp() set search_path = '';
alter function app.try_uuid(text) set search_path = '';
alter function app.guard_college_update() set search_path = '';
alter function app.compute_registration_dedupe_key(text, text, text, text) set search_path = '';
alter function app.events_set_creator() set search_path = '';
alter function app.stamp_membership_end() set search_path = '';
alter function app.ledger_guard() set search_path = '';
alter function app.block_mutation() set search_path = '';
alter function app.create_event_policies(text, text, text, boolean) set search_path = '';
alter function app.grant_permissions(text, text[]) set search_path = '';
