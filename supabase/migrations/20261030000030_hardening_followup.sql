-- ============================================================================
-- EVENT APP — Migration 30: advisor follow-ups after features 11–19
-- ============================================================================
alter function app.super_admin_email() set search_path = '';
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
