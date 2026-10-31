-- ============================================================================
-- EVENT APP — Migration 32: Super Admin can delete participants
-- ============================================================================
-- Registrations are append-only for everyone else (cancel instead). The Super
-- Admin can delete one outright, with its items, scores, results, certificates
-- and payment attempts, unless money for it reached the ledger: ledger entries
-- are permanent, so those registrations must be cancelled (and refunded) instead.

create or replace function app.block_registration_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_test or coalesce(current_setting('app.participant_delete_rpc', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create or replace function public.delete_registration(p_registration uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.registrations;
begin
  if not app.is_super_admin() then raise exception 'Only the Super Admin can delete participants' using errcode = '42501'; end if;
  select * into r from public.registrations where id = p_registration for update;
  if r.id is null then raise exception 'Registration not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.financial_transactions t
              where t.registration_id = r.id
                 or t.payment_id in (select p.id from public.payments p where p.registration_id = r.id)) then
    raise exception 'This participant has payments in the finance ledger, which must be kept. Cancel the registration (and record a refund) instead.' using errcode = '22023';
  end if;
  perform set_config('app.participant_delete_rpc', 'on', true);
  delete from public.payments where registration_id = r.id;
  delete from public.registrations where id = r.id;   -- items, scores, results, certificates, survey invites cascade
  perform set_config('app.participant_delete_rpc', 'off', true);
  perform app.log_activity(r.event_id, null, 'registration.deleted',
    'Participant deleted: ' || left(r.participant_name, 120) || ' (' || r.registration_number || ')' || coalesce(' — ' || nullif(left(trim(p_reason), 200), ''), ''),
    'registrations', r.id, 'registrations.view');
end $$;

revoke execute on function public.delete_registration(uuid, text) from public, anon;
grant execute on function public.delete_registration(uuid, text) to authenticated, service_role;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
