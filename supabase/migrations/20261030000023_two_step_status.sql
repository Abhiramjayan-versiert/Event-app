-- ============================================================================
-- EVENT APP — Migration 23: who has two-step sign-in (Super Admin only)
-- ============================================================================
create or replace function public.two_step_users()
returns table (user_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then
    raise exception 'Only a Super Admin can view two-step sign-in status' using errcode = '42501';
  end if;
  return query select distinct f.user_id from auth.mfa_factors f where f.status::text = 'verified';
end $$;

revoke execute on function public.two_step_users() from public, anon;
grant execute on function public.two_step_users() to authenticated, service_role;
