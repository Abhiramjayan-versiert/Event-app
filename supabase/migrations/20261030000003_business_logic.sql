-- ============================================================================
-- EVENT APP — Migration 3: Business logic
-- Ledger integrity, numbering, duplicate detection, workspace bootstrap,
-- activity feed, notifications, audit trail and financial calculations.
-- ============================================================================

-- Human readable numbers are assigned by triggers; the column defaults exist
-- only so clients never have to (and cannot meaningfully) supply them.
alter table public.registrations alter column registration_number set default '';
alter table public.expense_requests alter column request_number set default '';
alter table public.financial_transactions alter column txn_number set default '';

-- ---------------------------------------------------------------------------
-- Activity feed & notifications helpers
-- ---------------------------------------------------------------------------
create or replace function app.log_activity(
  p_event uuid, p_department uuid, p_type text, p_summary text,
  p_entity_type text default null, p_entity_id uuid default null,
  p_required_permission text default 'event.view', p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (event_id, college_id, department_id, actor_id, activity_type, summary,
                                   entity_type, entity_id, required_permission, metadata)
  values (p_event, (select college_id from public.events where id = p_event), p_department, auth.uid(), p_type,
          left(p_summary, 500), p_entity_type, p_entity_id, p_required_permission, coalesce(p_metadata, '{}'::jsonb));
end $$;

create or replace function app.notify(
  p_user uuid, p_event uuid, p_type text, p_title text, p_body text default null,
  p_link text default null, p_data jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, event_id, type, title, body, link, data)
  values (p_user, p_event, p_type, left(p_title, 200), p_body, p_link, coalesce(p_data, '{}'::jsonb));
end $$;

-- Notify every active holder of a permission within an event (e.g. finance.review).
create or replace function app.notify_permission_holders(
  p_event uuid, p_perm text, p_type text, p_title text, p_body text default null, p_link text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, event_id, type, title, body, link)
  select distinct u.user_id, p_event, p_type, left(p_title, 200), p_body, p_link
  from (
    select em.user_id, em.role_id from public.event_members em
    where em.event_id = p_event and em.status = 'active' and em.ended_at is null
    union all
    select dm.user_id, dm.role_id from public.department_members dm
    where dm.event_id = p_event and dm.status = 'active' and dm.ended_at is null
  ) u
  join public.role_permissions rp on rp.role_id = u.role_id
  join public.permissions pm on pm.id = rp.permission_id and pm.key = p_perm
  where u.user_id is distinct from auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- Event workspace bootstrap
-- ---------------------------------------------------------------------------
create or replace function app.bootstrap_event_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_departments jsonb := '[
    ["Finance", "finance", "wallet"], ["Media and PR", "media", "camera"], ["Marketing", "marketing", "megaphone"],
    ["Sponsorship", "sponsorship", "handshake"], ["Registration", "registration", "clipboard-list"],
    ["Technical", "technical", "cpu"], ["Logistics", "logistics", "truck"], ["Stage and Production", "operations", "presentation"],
    ["Hospitality", "hospitality", "coffee"], ["Transportation", "logistics", "bus"], ["Accommodation", "hospitality", "bed"],
    ["Food and Catering", "hospitality", "utensils"], ["Security", "operations", "shield"],
    ["Creative and Design", "media", "palette"], ["Documentation", "general", "file-text"],
    ["Volunteer Management", "general", "users"], ["Guest Management", "hospitality", "user-check"],
    ["Public Relations", "media", "radio"]
  ]'::jsonb;
  v_packages jsonb := '[
    ["Title Sponsor", 1], ["Powered By Sponsor", 2], ["Associate Sponsor", 3], ["Gold Sponsor", 4],
    ["Silver Sponsor", 5], ["Bronze Sponsor", 6], ["Media Partner", 7], ["Technical Partner", 8],
    ["Food Partner", 9], ["Custom Package", 10]
  ]'::jsonb;
  d jsonb;
  i int := 0;
begin
  insert into public.event_settings (event_id, college_id) values (new.id, new.college_id);
  insert into public.budgets (event_id, college_id, currency) values (new.id, new.college_id, new.currency);

  for d in select * from jsonb_array_elements(v_departments) loop
    i := i + 1;
    insert into public.departments (event_id, college_id, name, kind, icon, sort_order, created_by)
    values (new.id, new.college_id, d ->> 0, (d ->> 1)::public.department_kind, d ->> 2, i * 10, new.created_by);
  end loop;

  for d in select * from jsonb_array_elements(v_packages) loop
    insert into public.sponsorship_packages (event_id, college_id, name, tier_order, is_custom)
    values (new.id, new.college_id, d ->> 0, (d ->> 1)::int, (d ->> 0) = 'Custom Package');
  end loop;

  perform app.log_activity(new.id, null, 'event.created', 'Event "' || new.name || '" was created', 'events', new.id);
  return new;
end $$;

create trigger events_bootstrap after insert on public.events
  for each row execute function app.bootstrap_event_workspace();

-- ---------------------------------------------------------------------------
-- Registrations: numbering, currency, duplicate key, activity
-- ---------------------------------------------------------------------------
create or replace function app.compute_registration_dedupe_key(
  p_rule text, p_email text, p_phone text, p_category text
) returns text
language sql immutable as $$
  select case p_rule
    when 'email_per_event' then lower(trim(p_email))
    when 'email_per_category' then lower(trim(p_email)) || '|' || lower(trim(coalesce(p_category, '')))
    when 'phone_per_category' then
      case when p_phone is null then null
           else regexp_replace(p_phone, '\D', '', 'g') || '|' || lower(trim(coalesce(p_category, ''))) end
    else null
  end
$$;

create or replace function app.registrations_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_rule text;
begin
  if tg_op = 'INSERT' then
    new.registration_number := app.next_number(new.event_id, 'registration', 'REG');
    select e.currency into new.currency from public.events e where e.id = new.event_id;
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;

  select coalesce(s.registration_settings ->> 'duplicate_rule', 'email_per_category') into v_rule
  from public.event_settings s where s.event_id = new.event_id;
  new.dedupe_key := app.compute_registration_dedupe_key(v_rule, new.email, new.phone, new.category);

  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status <> 'cancelled') then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  -- payable_amount is a generated column and is not yet computed in BEFORE triggers.
  if greatest(new.amount - new.discount, 0) = 0 and new.payment_status = 'pending' then
    new.payment_status := 'not_required';
  end if;
  return new;
end $$;
-- "b_" prefix → after the "a_" parent trigger but before the scope guard.
create trigger registrations_b_write before insert or update on public.registrations
  for each row execute function app.registrations_before_write();

create or replace function app.registrations_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.log_activity(new.event_id, null, 'registration.created',
    'New registration ' || new.registration_number || ' (' || new.category || ')',
    'registrations', new.id, 'registrations.view');
  return new;
end $$;
create trigger registrations_activity after insert on public.registrations
  for each row execute function app.registrations_after_insert();

-- ---------------------------------------------------------------------------
-- Financial ledger: numbering, direction, verification stamps, immutability
-- ---------------------------------------------------------------------------
create or replace function app.ledger_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_orig public.financial_transactions;
begin
  new.txn_number := app.next_number(new.event_id, 'ledger', 'TXN');
  select e.currency into new.currency from public.events e where e.id = new.event_id;
  new.recorded_by := coalesce(new.recorded_by, auth.uid());

  if new.kind = 'income' then
    new.direction := 'in';
  elsif new.kind in ('expense', 'refund') then
    new.direction := 'out';
  elsif new.kind = 'reversal' then
    select * into v_orig from public.financial_transactions where id = new.reverses_transaction_id;
    if v_orig.id is null or v_orig.event_id <> new.event_id then
      raise exception 'Reversal must reference a transaction of the same event' using errcode = '42501';
    end if;
    if v_orig.status <> 'verified' then
      raise exception 'Only verified transactions can be reversed' using errcode = '42501';
    end if;
    new.direction := case v_orig.direction when 'in' then 'out'::public.txn_direction else 'in'::public.txn_direction end;
    new.amount := v_orig.amount;
    new.category := v_orig.category;
  end if;

  if new.status = 'verified' then
    new.verified_at := coalesce(new.verified_at, now());
    new.verified_by := coalesce(new.verified_by, auth.uid());
  end if;
  return new;
end $$;
create trigger financial_transactions_b_insert before insert on public.financial_transactions
  for each row execute function app.ledger_before_insert();

create or replace function app.ledger_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Financial transactions cannot be deleted. Record a reversal instead.' using errcode = '42501';
  end if;

  if (new.event_id, new.txn_number, new.kind, new.direction, new.category, new.amount, new.currency,
      new.occurred_on, new.registration_id, new.payment_id, new.sponsor_id, new.sponsorship_payment_id,
      new.expense_request_id, new.reverses_transaction_id, new.recorded_by, new.created_at)
     is distinct from
     (old.event_id, old.txn_number, old.kind, old.direction, old.category, old.amount, old.currency,
      old.occurred_on, old.registration_id, old.payment_id, old.sponsor_id, old.sponsorship_payment_id,
      old.expense_request_id, old.reverses_transaction_id, old.recorded_by, old.created_at) then
    raise exception 'Financial transaction values are immutable. Record a reversal or adjustment instead.'
      using errcode = '42501';
  end if;

  if old.status in ('rejected', 'reversed') and new.status <> old.status then
    raise exception 'Transaction % is final (%)', old.txn_number, old.status using errcode = '42501';
  end if;

  if old.status = 'verified' and new.status not in ('verified', 'reversed') then
    raise exception 'A verified transaction can only be reversed' using errcode = '42501';
  end if;

  if new.status = 'reversed' and old.status <> 'reversed' and not exists (
    select 1 from public.financial_transactions r where r.reverses_transaction_id = old.id
  ) then
    raise exception 'Create a reversal entry before marking a transaction reversed' using errcode = '42501';
  end if;

  if new.status = 'verified' and old.status <> 'verified' then
    new.verified_at := now();
    new.verified_by := coalesce(auth.uid(), new.verified_by);
  end if;
  return new;
end $$;
create trigger financial_transactions_guard before update or delete on public.financial_transactions
  for each row execute function app.ledger_guard();

-- Expense approvals and audit logs are append-only.
create or replace function app.block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
create trigger expense_approvals_append_only before update or delete on public.expense_approvals
  for each row execute function app.block_mutation();
create trigger audit_logs_append_only before update on public.audit_logs
  for each row execute function app.block_mutation();

-- Records referenced by financial history cannot be hard-deleted.
create trigger registrations_no_delete before delete on public.registrations
  for each row execute function app.block_mutation();
create trigger payments_no_delete before delete on public.payments
  for each row execute function app.block_mutation();
create trigger sponsorship_payments_no_delete before delete on public.sponsorship_payments
  for each row execute function app.block_mutation();
create trigger expense_requests_no_delete before delete on public.expense_requests
  for each row execute function app.block_mutation();

create or replace function app.expense_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.request_number := app.next_number(new.event_id, 'expense', 'EXP');
  new.submitted_by := coalesce(new.submitted_by, auth.uid());
  return new;
end $$;
create trigger expense_requests_b_insert before insert on public.expense_requests
  for each row execute function app.expense_before_insert();

-- Sponsorship deal received amount = verified sponsorship payments.
create or replace function app.refresh_deal_received() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_deal uuid := coalesce(new.deal_id, old.deal_id);
begin
  update public.sponsorship_deals d
     set received_amount = coalesce((
       select sum(p.amount) from public.sponsorship_payments p where p.deal_id = v_deal and p.status = 'verified'
     ), 0)
   where d.id = v_deal;
  return null;
end $$;
create trigger sponsorship_payments_refresh after insert or update on public.sponsorship_payments
  for each row execute function app.refresh_deal_received();

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_secret_keys text[] := array['key_hash', 'webhook_secret_hash'];
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;
  insert into public.audit_logs (actor_id, actor_role, college_id, event_id, action, entity_type, entity_id, old_data, new_data)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'role', current_user),
    case when tg_table_name = 'colleges' then (v_row ->> 'id')::uuid else nullif(v_row ->> 'college_id', '')::uuid end,
    case when tg_table_name = 'events' then (v_row ->> 'id')::uuid else nullif(v_row ->> 'event_id', '')::uuid end,
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'event_id'),
    v_old - v_secret_keys,
    v_new - v_secret_keys
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'roles', 'role_permissions', 'colleges', 'college_members', 'events', 'event_settings',
    'event_members', 'departments', 'department_members', 'event_competitions', 'registrations', 'payments',
    'vendors', 'documents', 'sponsors', 'sponsorship_packages', 'sponsorship_deals', 'sponsorship_payments',
    'sponsorship_deliverables', 'budgets', 'budget_allocations', 'budget_revisions', 'expense_requests',
    'financial_transactions', 'tasks', 'task_assignments', 'announcements', 'venues', 'inventory',
    'event_schedules', 'emergency_contacts', 'media_assets', 'marketing_campaigns', 'api_credentials'
  ]
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Financial summary (single source of truth for every finance figure)
--
--   total_income_received   = verified income (registrations + sponsorship + other)
--                             + verified inbound adjustments
--   refunds_paid            = verified refunds
--   expenditure_paid        = verified expense payments + verified outbound adjustments
--   approved_unpaid         = Σ(approved_amount − paid_amount) of approved/partially-paid requests
--   outstanding_sponsorship = Σ max(agreed − received, 0) over confirmed deals
--   net_cash_position       = total_income_received − refunds_paid − expenditure_paid
--
-- Pending/failed/rejected entries are never counted. A reversed transaction is
-- excluded (status = 'reversed'); its reversal entry is informational only.
-- ---------------------------------------------------------------------------
create or replace function app.financial_summary(p_events uuid[], p_from date default null, p_to date default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with ledger as (
    select t.* from public.financial_transactions t
    where t.event_id = any(p_events) and t.status = 'verified'
      and (p_from is null or t.occurred_on >= p_from)
      and (p_to is null or t.occurred_on <= p_to)
  ),
  income as (
    select
      coalesce(sum(amount) filter (where kind = 'income' and category in ('online_registration', 'offline_registration')), 0) as registration,
      coalesce(sum(amount) filter (where kind = 'income' and category = 'sponsorship'), 0) as sponsorship,
      coalesce(sum(amount) filter (where kind = 'income' and category not in ('online_registration', 'offline_registration', 'sponsorship')), 0)
        + coalesce(sum(amount) filter (where kind = 'adjustment' and direction = 'in'), 0) as other,
      coalesce(sum(amount) filter (where kind = 'refund'), 0) as refunds,
      coalesce(sum(amount) filter (where kind = 'expense'), 0)
        + coalesce(sum(amount) filter (where kind = 'adjustment' and direction = 'out'), 0) as expenditure
    from ledger
  ),
  expenses as (
    select
      coalesce(sum(greatest(coalesce(approved_amount, 0) - paid_amount, 0)) filter (where status in ('approved', 'partially_paid')), 0) as approved_unpaid,
      coalesce(sum(coalesce(approved_amount, 0)) filter (where status in ('approved', 'partially_paid', 'paid')), 0) as approved_total,
      count(*) filter (where status in ('submitted', 'under_review', 'forwarded', 'changes_requested')) as pending_count,
      coalesce(sum(requested_amount) filter (where status in ('submitted', 'under_review', 'forwarded', 'changes_requested')), 0) as pending_amount
    from public.expense_requests
    where event_id = any(p_events)
  ),
  sponsorship as (
    select
      coalesce(sum(agreed_amount), 0) as committed,
      coalesce(sum(greatest(agreed_amount - received_amount, 0)), 0) as outstanding
    from public.sponsorship_deals
    where event_id = any(p_events) and stage in ('confirmed', 'partially_paid', 'fully_paid')
  ),
  budget as (
    select coalesce(sum(b.total_amount), 0) as total,
           coalesce((select sum(a.allocated_amount) from public.budget_allocations a where a.event_id = any(p_events)), 0) as allocated
    from public.budgets b where b.event_id = any(p_events)
  )
  select jsonb_build_object(
    'total_budget', budget.total,
    'allocated_budget', budget.allocated,
    'registration_income', income.registration,
    'sponsorship_income', income.sponsorship,
    'other_income', income.other,
    'total_income_received', income.registration + income.sponsorship + income.other,
    'refunds_paid', income.refunds,
    'expenditure_paid', income.expenditure,
    'approved_expenses_total', expenses.approved_total,
    'approved_unpaid', expenses.approved_unpaid,
    'pending_expense_count', expenses.pending_count,
    'pending_expense_amount', expenses.pending_amount,
    'sponsorship_committed', sponsorship.committed,
    'outstanding_sponsorship', sponsorship.outstanding,
    'net_cash_position', income.registration + income.sponsorship + income.other - income.refunds - income.expenditure
  )
  from income, expenses, sponsorship, budget
$$;

create or replace function public.event_financial_summary(p_event uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_event_permission(p_event, 'finance.view') then
    raise exception 'Not authorized to view finances for this event' using errcode = '42501';
  end if;
  return app.financial_summary(array[p_event], p_from, p_to);
end $$;
