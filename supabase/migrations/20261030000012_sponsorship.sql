-- ============================================================================
-- EVENT APP — Migration 12: Sponsorship CRM (Phase 6)
-- ============================================================================

-- Finance verifies (or rejects) a recorded sponsorship payment. Verification
-- books the money in the ledger exactly once and advances the deal stage.
create or replace function public.verify_sponsorship_payment(p_payment uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  sp public.sponsorship_payments;
  d public.sponsorship_deals;
  s public.sponsors;
begin
  select * into sp from public.sponsorship_payments where id = p_payment for update;
  if sp.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(sp.event_id, 'finance.manage') then
    raise exception 'Only finance can verify sponsorship payments' using errcode = '42501';
  end if;
  if sp.status <> 'pending' then raise exception 'This payment was already processed' using errcode = '22023'; end if;
  select * into d from public.sponsorship_deals where id = sp.deal_id for update;
  select * into s from public.sponsors where id = sp.sponsor_id;

  if not p_approve then
    update public.sponsorship_payments set status = 'rejected', verified_by = app.active_uid(), verified_at = now(),
           notes = coalesce(notes || E'\n', '') || 'Rejected: ' || coalesce(nullif(trim(p_note), ''), 'no reason given')
     where id = sp.id;
    return;
  end if;

  update public.sponsorship_payments set status = 'verified', verified_by = app.active_uid(), verified_at = now() where id = sp.id;
  insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, occurred_on, description,
                                             payment_method, payment_reference, status, sponsor_id, sponsorship_payment_id, document_id)
  values (sp.event_id, sp.college_id, 'income', 'in', 'sponsorship', sp.amount, sp.paid_on, 'Sponsorship · ' || s.company_name,
          sp.payment_method, sp.reference, 'verified', s.id, sp.id, sp.receipt_document_id);

  -- received_amount is refreshed by trigger; advance the pipeline stage.
  select * into d from public.sponsorship_deals where id = d.id;
  if d.stage in ('confirmed', 'partially_paid', 'negotiation', 'proposal_sent') then
    update public.sponsorship_deals
       set stage = case when d.agreed_amount > 0 and d.received_amount >= d.agreed_amount then 'fully_paid'::public.sponsor_stage else 'partially_paid'::public.sponsor_stage end
     where id = d.id;
  end if;

  perform app.log_activity(sp.event_id, null, 'sponsorship.payment',
    'Sponsorship payment of ' || sp.amount || ' received from ' || s.company_name, 'sponsorship_payments', sp.id, 'sponsors.view');
  perform app.notify(d.owner_id, sp.event_id, 'sponsorship.payment_verified', 'Sponsorship payment verified',
    s.company_name || ' · ' || sp.amount, '/events/' || sp.event_id || '/sponsorship/deals/' || d.id);
end $$;
revoke execute on function public.verify_sponsorship_payment(uuid, boolean, text) from public, anon;
grant execute on function public.verify_sponsorship_payment(uuid, boolean, text) to authenticated, service_role;

-- Stamp who recorded a payment and tell finance it needs verification.
create or replace function app.sponsorship_payment_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.notify_permission_holders(new.event_id, 'finance.manage', 'sponsorship.payment_recorded',
    'Sponsorship payment to verify', (select company_name from public.sponsors where id = new.sponsor_id) || ' · ' || new.amount,
    '/events/' || new.event_id || '/sponsorship?tab=payments');
  return null;
end $$;
create trigger sponsorship_payments_notify after insert on public.sponsorship_payments
  for each row execute function app.sponsorship_payment_after_insert();

create or replace function app.sponsorship_payment_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.recorded_by := coalesce(new.recorded_by, auth.uid());
  return new;
end $$;
create trigger sponsorship_payments_c_defaults before insert on public.sponsorship_payments
  for each row execute function app.sponsorship_payment_defaults();

-- Deal bookkeeping: confirmation date, creator, activity on stage changes.
create or replace function app.sponsorship_deal_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.owner_id := coalesce(new.owner_id, auth.uid());
  end if;
  if new.stage in ('confirmed', 'partially_paid', 'fully_paid') and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;
  return new;
end $$;
create trigger sponsorship_deals_b_write before insert or update on public.sponsorship_deals
  for each row execute function app.sponsorship_deal_before_write();

create or replace function app.sponsorship_deal_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  if tg_op = 'UPDATE' and new.stage = old.stage then return null; end if;
  select company_name into v_company from public.sponsors where id = new.sponsor_id;
  perform app.log_activity(new.event_id, null,
    case when new.stage = 'confirmed' then 'sponsorship.confirmed' else 'sponsorship.stage' end,
    v_company || case when tg_op = 'INSERT' then ' added to the pipeline (' else ' moved to ' end || replace(new.stage::text, '_', ' ') || case when tg_op = 'INSERT' then ')' else '' end,
    'sponsorship_deals', new.id, 'sponsors.view');
  return null;
end $$;
create trigger sponsorship_deals_activity after insert or update on public.sponsorship_deals
  for each row execute function app.sponsorship_deal_after_write();

create or replace function app.sponsor_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger sponsors_b_insert before insert on public.sponsors
  for each row execute function app.sponsor_before_insert();

create or replace function app.deliverable_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger sponsorship_deliverables_b_write before insert or update on public.sponsorship_deliverables
  for each row execute function app.deliverable_before_write();

-- Sponsorship payments may be edited only while pending, by those who can record them.
create policy sponsorship_payments_update on public.sponsorship_payments for update to authenticated
  using (status = 'pending' and ((select app.is_super_admin())
         or event_id = any((select app.event_ids_with_permission('sponsors.manage'))::uuid[])
         or event_id = any((select app.event_ids_with_permission('finance.manage'))::uuid[])))
  with check (status = 'pending');

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
