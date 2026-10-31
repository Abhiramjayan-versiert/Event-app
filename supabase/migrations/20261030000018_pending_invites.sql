-- ============================================================================
-- EVENT APP — Migration 18: pending invitations (Super Admin only)
-- ============================================================================
-- Lists accounts that were invited but have not accepted yet, so the Users
-- screen can label them and offer "Resend invitation". auth.users is not
-- readable through the Data API, hence this narrow SECURITY DEFINER function.

create or replace function public.pending_invitations()
returns table (user_id uuid, invited_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then
    raise exception 'Only a Super Admin can view pending invitations' using errcode = '42501';
  end if;
  return query
    select u.id, u.invited_at
    from auth.users u
    where u.invited_at is not null and u.email_confirmed_at is null and u.last_sign_in_at is null;
end $$;

revoke execute on function public.pending_invitations() from public, anon;
grant execute on function public.pending_invitations() to authenticated, service_role;
