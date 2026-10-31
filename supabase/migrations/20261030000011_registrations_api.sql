-- ============================================================================
-- EVENT APP — Migration 11: Registrations & public website API (Phase 5)
-- ============================================================================

-- Sandbox (test-mode) data is flagged so it never reaches the ledger and can
-- be cleared. Real registrations and payments remain undeletable.
alter table public.registrations add column is_test boolean not null default false;
alter table public.payments add column is_test boolean not null default false;

create or replace function app.block_registration_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_test then return old; end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
drop trigger registrations_no_delete on public.registrations;
create trigger registrations_no_delete before delete on public.registrations
  for each row execute function app.block_registration_delete();
drop trigger payments_no_delete on public.payments;
create trigger payments_no_delete before delete on public.payments
  for each row execute function app.block_registration_delete();

-- ---------------------------------------------------------------------------
-- Registration management (staff)
-- ---------------------------------------------------------------------------
create or replace function public.registration_set_status(p_registration uuid, p_status public.registration_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.registrations;
begin
  select * into r from public.registrations where id = p_registration for update;
  if r.id is null then raise exception 'Registration not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(r.event_id, 'registrations.manage') then
    raise exception 'You cannot manage registrations' using errcode = '42501';
  end if;
  if r.status = 'cancelled' then raise exception 'Cancelled registrations cannot be changed' using errcode = '22023'; end if;
  if p_status = 'cancelled' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A cancellation reason is required' using errcode = '22023';
  end if;
  update public.registrations
     set status = p_status,
         cancellation_reason = case when p_status = 'cancelled' then trim(p_reason) else cancellation_reason end,
         payment_status = case when p_status = 'cancelled' and payment_status = 'pending' then 'cancelled'::public.payment_status else payment_status end,
         verified_by = case when p_status = 'confirmed' then app.active_uid() else verified_by end,
         verified_at = case when p_status = 'confirmed' then now() else verified_at end
   where id = r.id;
  perform app.log_activity(r.event_id, null, 'registration.' || p_status,
    r.registration_number || ' marked ' || p_status || coalesce(': ' || nullif(trim(p_reason), ''), ''), 'registrations', r.id, 'registrations.view');
end $$;

-- Records an offline payment (cash/UPI at the desk). Finance managers book it
-- as verified income immediately; registration staff create a pending entry
-- for finance to verify.
create or replace function public.registration_record_offline_payment(
  p_registration uuid, p_amount numeric, p_method text, p_reference text default null, p_paid_on date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.registrations;
  v_fin boolean;
  v_txn uuid;
begin
  select * into r from public.registrations where id = p_registration for update;
  if r.id is null then raise exception 'Registration not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(r.event_id, 'registrations.manage') then
    raise exception 'You cannot record registration payments' using errcode = '42501';
  end if;
  if r.status = 'cancelled' then raise exception 'The registration is cancelled' using errcode = '22023'; end if;
  if r.is_test then raise exception 'Test registrations cannot take real payments' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > r.payable_amount - r.amount_paid then
    raise exception 'Amount must be between 0 and the balance due (%)', r.payable_amount - r.amount_paid using errcode = '22023';
  end if;
  v_fin := app.has_event_permission(r.event_id, 'finance.manage');

  insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, occurred_on, description,
                                             payment_method, payment_reference, status, registration_id)
  values (r.event_id, r.college_id, 'income', 'in', 'offline_registration', p_amount, coalesce(p_paid_on, current_date),
          r.registration_number || ' · ' || r.participant_name, p_method, nullif(trim(p_reference), ''),
          case when v_fin then 'verified'::public.txn_status else 'pending'::public.txn_status end, r.id)
  returning id into v_txn;

  update public.registrations
     set amount_paid = amount_paid + p_amount,
         payment_status = case when amount_paid + p_amount >= payable_amount then 'paid'::public.payment_status else 'pending'::public.payment_status end,
         status = case when amount_paid + p_amount >= payable_amount then 'confirmed'::public.registration_status else status end,
         payment_gateway = coalesce(payment_gateway, 'offline'),
         payment_reference = coalesce(nullif(trim(p_reference), ''), payment_reference),
         verified_by = app.active_uid(), verified_at = now()
   where id = r.id;
  return v_txn;
end $$;

create or replace function public.registration_record_refund(
  p_registration uuid, p_amount numeric, p_method text, p_reason text, p_reference text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.registrations;
  v_txn uuid;
begin
  select * into r from public.registrations where id = p_registration for update;
  if r.id is null then raise exception 'Registration not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(r.event_id, 'finance.manage') then
    raise exception 'Only finance can record refunds' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A refund reason is required' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > r.amount_paid - r.amount_refunded then
    raise exception 'Refund must be between 0 and the refundable amount (%)', r.amount_paid - r.amount_refunded using errcode = '22023';
  end if;

  insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, occurred_on, description,
                                             payment_method, payment_reference, status, registration_id, notes)
  values (r.event_id, r.college_id, 'refund', 'out', 'registration_refund', p_amount, current_date,
          'Refund ' || r.registration_number || ' · ' || r.participant_name, p_method, nullif(trim(p_reference), ''), 'verified', r.id, trim(p_reason))
  returning id into v_txn;

  update public.registrations
     set amount_refunded = amount_refunded + p_amount,
         payment_status = case when amount_refunded + p_amount >= amount_paid then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end
   where id = r.id;
  perform app.log_activity(r.event_id, null, 'registration.refund',
    'Refund of ' || p_amount || ' recorded for ' || r.registration_number, 'registrations', r.id, 'finance.view');
  return v_txn;
end $$;

create or replace function public.registration_dashboard(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_from date;
begin
  if not app.has_event_permission(p_event, 'registrations.view') then
    raise exception 'Not authorized to view registrations' using errcode = '42501';
  end if;
  select least(current_date - 29, coalesce(min(created_at)::date, current_date)) into v_from from public.registrations where event_id = p_event;

  return (
    with r as (select * from public.registrations where event_id = p_event),
    live as (select * from r where status <> 'cancelled'),
    days as (select generate_series(v_from, current_date, interval '1 day')::date d)
    select jsonb_build_object(
      'total', (select count(*) from r),
      'confirmed', (select count(*) from r where status = 'confirmed'),
      'pending_payments', (select count(*) from r where payment_status = 'pending' and status <> 'cancelled'),
      'failed_payments', (select count(*) from r where payment_status = 'failed'),
      'cancelled', (select count(*) from r where status = 'cancelled'),
      'test', (select count(*) from r where is_test),
      'participants', (select coalesce(sum(1 + jsonb_array_length(team_members)), 0) from live),
      'collected', (select coalesce(sum(amount_paid - amount_refunded), 0) from live where not is_test),
      'average_value', (select coalesce(round(avg(amount_paid - amount_refunded) filter (where amount_paid > 0), 2), 0) from live where not is_test),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'count', n, 'collected', c) order by n desc), '[]'::jsonb)
                      from (select category, count(*) n, sum(amount_paid - amount_refunded) c from live group by category) s),
      'by_payment_status', (select coalesce(jsonb_agg(jsonb_build_object('status', payment_status, 'count', n)), '[]'::jsonb)
                            from (select payment_status, count(*) n from r group by payment_status) s),
      'by_college', (select coalesce(jsonb_agg(jsonb_build_object('college', college, 'count', n) order by n desc), '[]'::jsonb)
                     from (select coalesce(nullif(trim(participant_college), ''), 'Not specified') college, count(*) n from live group by 1 order by 2 desc limit 15) s),
      'by_source', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) n from r group by source) s),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', days.d, 'registrations', coalesce(x.n, 0)) order by days.d), '[]'::jsonb)
                from days left join (select created_at::date d, count(*) n from r group by 1) x on x.d = days.d)
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- API credentials (keys are generated server-side; only the hash is stored)
-- ---------------------------------------------------------------------------
create or replace function public.create_api_credential(
  p_event uuid, p_name text, p_environment public.api_environment, p_key_prefix text, p_key_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.has_event_permission(p_event, 'integrations.manage') then
    raise exception 'You cannot manage integrations' using errcode = '42501';
  end if;
  if p_key_hash !~ '^[0-9a-f]{64}$' or p_key_prefix !~ '^eak_(live|test)_[a-z0-9]{10}$' then
    raise exception 'Invalid credential format' using errcode = '22023';
  end if;
  insert into public.api_credentials (event_id, college_id, name, environment, key_prefix, key_hash, created_by)
  select p_event, e.college_id, left(coalesce(nullif(trim(p_name), ''), 'Website'), 80), p_environment, p_key_prefix, p_key_hash, app.active_uid()
  from public.events e where e.id = p_event
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_api_credential(p_credential uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.api_credentials where id = p_credential;
  if v_event is null then raise exception 'Credential not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(v_event, 'integrations.manage') then
    raise exception 'You cannot manage integrations' using errcode = '42501';
  end if;
  update public.api_credentials set revoked_at = now(), revoked_by = app.active_uid() where id = p_credential and revoked_at is null;
end $$;

create or replace function public.clear_sandbox_data(p_event uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if not app.has_event_permission(p_event, 'integrations.manage') then
    raise exception 'You cannot manage integrations' using errcode = '42501';
  end if;
  delete from public.payments where event_id = p_event and is_test;
  delete from public.registrations where event_id = p_event and is_test;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Service-role-only API helpers (called by /api/v1 route handlers)
-- ---------------------------------------------------------------------------
create or replace function public.api_authenticate(p_key_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.api_credentials;
begin
  select * into c from public.api_credentials
   where key_hash = p_key_hash and revoked_at is null and (expires_at is null or expires_at > now());
  if c.id is null then return null; end if;
  update public.api_credentials set last_used_at = now() where id = c.id;
  return jsonb_build_object('credential_id', c.id, 'event_id', c.event_id, 'college_id', c.college_id,
                            'environment', c.environment, 'scopes', to_jsonb(c.scopes));
end $$;

-- Fixed-window rate limiter shared by all serverless instances.
create or replace function public.api_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into app.rate_limit_buckets (bucket, window_start, hits) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = app.rate_limit_buckets.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from app.rate_limit_buckets where window_start < now() - interval '1 hour';
  end if;
  return v_hits <= p_limit;
end $$;

create or replace function public.api_idempotency_lookup(p_credential uuid, p_key text, p_request_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k app.api_idempotency_keys;
begin
  select * into k from app.api_idempotency_keys where credential_id = p_credential and idempotency_key = p_key;
  if k.credential_id is null then return null; end if;
  if k.request_hash <> p_request_hash then return jsonb_build_object('conflict', true); end if;
  return jsonb_build_object('conflict', false, 'status', k.response_status, 'body', k.response_body);
end $$;

create or replace function public.api_idempotency_store(p_credential uuid, p_key text, p_request_hash text, p_status int, p_body jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.api_idempotency_keys (credential_id, idempotency_key, request_hash, response_status, response_body)
  values (p_credential, p_key, p_request_hash, p_status, p_body)
  on conflict (credential_id, idempotency_key) do nothing;
end $$;

create or replace function public.api_log(
  p_event uuid, p_credential uuid, p_direction text, p_method text, p_endpoint text, p_status int,
  p_request_id text, p_idempotency_key text, p_ip text, p_duration int, p_error text, p_summary jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.api_integration_logs (event_id, credential_id, direction, method, endpoint, status_code, request_id,
                                           idempotency_key, ip_address, duration_ms, error, summary)
  values (p_event, p_credential, p_direction, p_method, left(p_endpoint, 300), p_status, p_request_id, p_idempotency_key,
          left(p_ip, 64), p_duration, left(p_error, 1000), coalesce(p_summary, '{}'::jsonb));
  if p_event is not null then
    if p_status < 400 then
      update public.event_settings set last_sync_at = now() where event_id = p_event;
    elsif p_status >= 500 or p_direction = 'webhook' then
      update public.event_settings set last_error = left(coalesce(p_error, 'HTTP ' || p_status), 500), last_error_at = now() where event_id = p_event;
    end if;
  end if;
end $$;

-- Creates a registration from the public website. Prices come from the
-- event's competitions; client-supplied amounts are ignored.
create or replace function public.api_create_registration(p_credential uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.api_credentials;
  e public.events;
  v_settings jsonb;
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_item jsonb;
  v_comp public.event_competitions;
  v_qty int;
  v_amount numeric := 0;
  v_type public.registration_type := coalesce(nullif(p_payload ->> 'registration_type', ''), 'individual')::public.registration_type;
  v_team jsonb := coalesce(p_payload -> 'team_members', '[]'::jsonb);
  v_category text;
  v_reg public.registrations;
  v_taken int;
begin
  select * into c from public.api_credentials where id = p_credential and revoked_at is null;
  if c.id is null then raise exception 'Invalid credential' using errcode = '42501'; end if;
  select * into e from public.events where id = c.event_id;
  select registration_settings into v_settings from public.event_settings where event_id = e.id;

  if e.status in ('completed', 'archived', 'registration_closed') then
    raise exception 'Registrations are closed for this event' using errcode = '22023';
  end if;
  if e.registration_opens_at is not null and now() < e.registration_opens_at then
    raise exception 'Registrations have not opened yet' using errcode = '22023';
  end if;
  if e.registration_closes_at is not null and now() > e.registration_closes_at then
    raise exception 'Registrations are closed' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'At least one item (competition) is required' using errcode = '22023';
  end if;
  if jsonb_typeof(v_team) <> 'array' then raise exception 'team_members must be an array' using errcode = '22023'; end if;
  if v_type = 'team' then
    if coalesce((v_settings ->> 'allow_team_registrations')::boolean, true) = false then
      raise exception 'Team registrations are not allowed for this event' using errcode = '22023';
    end if;
    if 1 + jsonb_array_length(v_team) > coalesce((v_settings ->> 'max_team_size')::int, 6) then
      raise exception 'Team is larger than the allowed maximum' using errcode = '22023';
    end if;
  end if;

  -- Validate items and compute the price.
  for v_item in select * from jsonb_array_elements(v_items) loop
    select * into v_comp from public.event_competitions
     where event_id = e.id and code = upper(v_item ->> 'competition_code') and is_active;
    if v_comp.id is null then
      raise exception 'Unknown competition code %', v_item ->> 'competition_code' using errcode = '22023';
    end if;
    v_qty := greatest(coalesce((v_item ->> 'quantity')::int, 1), 1);
    if v_comp.registration_type = 'team' and (1 + jsonb_array_length(v_team) < v_comp.team_min or 1 + jsonb_array_length(v_team) > v_comp.team_max) then
      raise exception '% requires a team of % to % people', v_comp.name, v_comp.team_min, v_comp.team_max using errcode = '22023';
    end if;
    if v_comp.capacity is not null then
      select count(*) into v_taken from public.registration_items ri join public.registrations rg on rg.id = ri.registration_id
       where ri.competition_id = v_comp.id and rg.status <> 'cancelled';
      if v_taken >= v_comp.capacity then raise exception '% is full', v_comp.name using errcode = '22023'; end if;
    end if;
    v_amount := v_amount + v_comp.fee * v_qty;
    v_category := coalesce(v_category, v_comp.category);
  end loop;

  insert into public.registrations (event_id, college_id, external_reference, participant_name, email, phone, participant_college,
                                    course, academic_year, category, registration_type, team_name, team_members, source, status,
                                    amount, custom_fields, api_credential_id, is_test)
  values (e.id, e.college_id, nullif(left(p_payload ->> 'external_reference', 120), ''),
          left(p_payload #>> '{participant,name}', 160), lower(trim(p_payload #>> '{participant,email}')),
          nullif(left(p_payload #>> '{participant,phone}', 32), ''), nullif(left(p_payload #>> '{participant,college}', 200), ''),
          nullif(left(p_payload #>> '{participant,course}', 120), ''), nullif(left(p_payload #>> '{participant,academic_year}', 20), ''),
          coalesce(v_category, 'general'), v_type, nullif(left(p_payload ->> 'team_name', 120), ''), v_team, 'api', 'pending',
          v_amount, coalesce(p_payload -> 'custom_fields', '{}'::jsonb), c.id, c.environment = 'sandbox')
  returning * into v_reg;

  for v_item in select * from jsonb_array_elements(v_items) loop
    select * into v_comp from public.event_competitions where event_id = e.id and code = upper(v_item ->> 'competition_code');
    insert into public.registration_items (registration_id, event_id, college_id, competition_id, item_name, category, quantity, unit_price)
    values (v_reg.id, e.id, e.college_id, v_comp.id, v_comp.name, v_comp.category, greatest(coalesce((v_item ->> 'quantity')::int, 1), 1), v_comp.fee);
  end loop;

  if coalesce((select (notification_settings ->> 'notify_on_registration')::boolean from public.event_settings where event_id = e.id), true) then
    perform app.notify_permission_holders(e.id, 'registrations.manage', 'registration.created',
      'New registration ' || v_reg.registration_number, v_reg.participant_name || ' · ' || v_reg.category,
      '/events/' || e.id || '/registrations/' || v_reg.id);
  end if;

  select * into v_reg from public.registrations where id = v_reg.id;
  return jsonb_build_object(
    'id', v_reg.id, 'registration_number', v_reg.registration_number, 'status', v_reg.status,
    'payment_status', v_reg.payment_status, 'amount', v_reg.payable_amount, 'currency', v_reg.currency, 'test', v_reg.is_test
  );
end $$;

create or replace function public.api_attach_payment_order(p_registration uuid, p_provider text, p_order_id text, p_amount numeric)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.payments (event_id, college_id, registration_id, provider, provider_order_id, amount, currency, status, is_test)
  select r.event_id, r.college_id, r.id, p_provider, p_order_id, p_amount, r.currency, 'pending', r.is_test
  from public.registrations r where r.id = p_registration;
  update public.registrations set payment_gateway = p_provider where id = p_registration;
end $$;

-- Applies a verified gateway event. Idempotent: a provider event id is
-- processed once, and a payment can be booked as income only once.
create or replace function public.apply_payment_event(
  p_provider text, p_provider_event_id text, p_event_type text, p_payload jsonb, p_signature_valid boolean,
  p_order_id text, p_payment_id text, p_amount numeric, p_currency text, p_method text, p_outcome text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_webhook uuid;
  p public.payments;
  r public.registrations;
begin
  insert into public.payment_webhook_events (provider, provider_event_id, event_type, signature_valid, payload)
  values (p_provider, p_provider_event_id, p_event_type, p_signature_valid, p_payload)
  on conflict (provider, provider_event_id) do update set attempts = public.payment_webhook_events.attempts + 1
  returning id into v_webhook;

  if exists (select 1 from public.payment_webhook_events where id = v_webhook and processed_at is not null) then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if not p_signature_valid then
    update public.payment_webhook_events set processing_error = 'Invalid signature' where id = v_webhook;
    return jsonb_build_object('result', 'rejected', 'reason', 'invalid_signature');
  end if;

  select * into p from public.payments where provider = p_provider and provider_order_id = p_order_id for update;
  if p.id is null then
    update public.payment_webhook_events set processing_error = 'Unknown order', processed_at = now() where id = v_webhook;
    return jsonb_build_object('result', 'ignored', 'reason', 'unknown_order');
  end if;
  update public.payment_webhook_events set event_id = p.event_id, payment_id = p.id where id = v_webhook;
  select * into r from public.registrations where id = p.registration_id for update;

  if p_outcome = 'failed' then
    if p.status <> 'paid' then
      update public.payments set status = 'failed', provider_payment_id = coalesce(p_payment_id, provider_payment_id),
             failure_reason = left(p_payload #>> '{payload,payment,entity,error_description}', 300), raw = p_payload where id = p.id;
      update public.registrations set payment_status = 'failed' where id = r.id and payment_status = 'pending';
    end if;
    update public.payment_webhook_events set processed_at = now() where id = v_webhook;
    return jsonb_build_object('result', 'failed_recorded');
  end if;

  if p_outcome <> 'paid' then
    update public.payment_webhook_events set processed_at = now() where id = v_webhook;
    return jsonb_build_object('result', 'ignored');
  end if;
  if p.status = 'paid' then
    update public.payment_webhook_events set processed_at = now() where id = v_webhook;
    return jsonb_build_object('result', 'already_paid');
  end if;
  if round(p_amount, 2) <> round(p.amount, 2) or upper(coalesce(p_currency, p.currency)) <> p.currency then
    update public.payment_webhook_events set processing_error = 'Amount or currency mismatch', processed_at = now() where id = v_webhook;
    update public.event_settings set last_error = 'Payment amount mismatch for ' || r.registration_number, last_error_at = now() where event_id = p.event_id;
    return jsonb_build_object('result', 'rejected', 'reason', 'amount_mismatch');
  end if;

  update public.payments
     set status = 'paid', provider_payment_id = coalesce(p_payment_id, provider_payment_id), method = p_method,
         verified_via = 'webhook', verified_at = now(), raw = p_payload
   where id = p.id;
  update public.registrations
     set amount_paid = amount_paid + p.amount, payment_status = 'paid', status = 'confirmed',
         payment_reference = coalesce(p_payment_id, payment_reference)
   where id = r.id;

  if not p.is_test then
    insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, occurred_on, description,
                                               payment_method, payment_reference, status, verified_at, registration_id, payment_id)
    values (p.event_id, p.college_id, 'income', 'in', 'online_registration', p.amount, current_date,
            r.registration_number || ' · ' || r.participant_name, coalesce(p_method, p_provider), p_payment_id, 'verified', now(), r.id, p.id)
    on conflict do nothing;
  end if;
  perform app.log_activity(p.event_id, null, 'payment.received',
    'Payment received for ' || r.registration_number || case when p.is_test then ' (test)' else '' end, 'payments', p.id, 'registrations.view');
  update public.payment_webhook_events set processed_at = now() where id = v_webhook;
  return jsonb_build_object('result', 'paid', 'registration_id', r.id);
end $$;

-- Lock the API helpers to the service role.
do $$
declare f text;
begin
  foreach f in array array[
    'public.api_authenticate(text)', 'public.api_rate_limit(text, integer, integer)',
    'public.api_idempotency_lookup(uuid, text, text)', 'public.api_idempotency_store(uuid, text, text, integer, jsonb)',
    'public.api_log(uuid, uuid, text, text, text, integer, text, text, text, integer, text, jsonb)',
    'public.api_create_registration(uuid, jsonb)', 'public.api_attach_payment_order(uuid, text, text, numeric)',
    'public.apply_payment_event(text, text, text, jsonb, boolean, text, text, numeric, text, text, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.registration_set_status(uuid, public.registration_status, text)',
    'public.registration_record_offline_payment(uuid, numeric, text, text, date)',
    'public.registration_record_refund(uuid, numeric, text, text, text)',
    'public.registration_dashboard(uuid)',
    'public.create_api_credential(uuid, text, public.api_environment, text, text)',
    'public.revoke_api_credential(uuid)',
    'public.clear_sandbox_data(uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
