-- ============================================================================
-- EVENT APP — Migration 24: public registration page, QR tickets, check-in
-- ============================================================================

-- 1. Tickets and attendance on registrations.
alter table public.registrations
  add column ticket_code text not null default upper(encode(extensions.gen_random_bytes(8), 'hex')),
  add column checked_in_at timestamptz,
  add column checked_in_by uuid references public.profiles (id) on delete set null;
alter table public.registrations add constraint registrations_ticket_code_key unique (ticket_code);
create index registrations_checked_in_idx on public.registrations (event_id) where checked_in_at is not null;

-- Ticket codes never change and attendance is recorded only through the RPCs.
create or replace function app.registrations_guard_ticket() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.ticket_code is distinct from old.ticket_code then
    raise exception 'Ticket codes cannot be changed' using errcode = '42501';
  end if;
  if (new.checked_in_at is distinct from old.checked_in_at or new.checked_in_by is distinct from old.checked_in_by)
     and coalesce(current_setting('app.checkin_rpc', true), '') <> 'on' then
    raise exception 'Use the check-in screen to record attendance' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger registrations_guard_ticket before update on public.registrations
  for each row execute function app.registrations_guard_ticket();

-- 2. Check-in permission (gate volunteers); event and college admins get it too.
insert into public.permissions (key, module, name, scope, sort_order, description)
values ('registrations.checkin', 'registrations', 'Check in participants', 'event', 66, 'Scan tickets and mark attendance at the gate')
on conflict (key) do nothing;
select app.grant_permissions(r, array['registrations.checkin']) from unnest(array['college_admin', 'event_admin', 'registration_head']) r;

-- 3. Shared registration logic (website API and public page).
create or replace function app.create_registration(p_event uuid, p_payload jsonb, p_source public.registration_source, p_credential uuid, p_is_test boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
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
  select * into e from public.events where id = p_event;
  if e.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
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
          coalesce(v_category, 'general'), v_type, nullif(left(p_payload ->> 'team_name', 120), ''), v_team, p_source, 'pending',
          v_amount, coalesce(p_payload -> 'custom_fields', '{}'::jsonb), p_credential, p_is_test)
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
    'payment_status', v_reg.payment_status, 'amount', v_reg.payable_amount, 'currency', v_reg.currency, 'test', v_reg.is_test,
    'ticket_code', v_reg.ticket_code
  );
end $$;

create or replace function public.api_create_registration(p_credential uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.api_credentials;
begin
  select * into c from public.api_credentials where id = p_credential and revoked_at is null;
  if c.id is null then raise exception 'Invalid credential' using errcode = '42501'; end if;
  return app.create_registration(c.event_id, p_payload, 'api', c.id, c.environment = 'sandbox');
end $$;

-- 4. Public page (service role only; the app server calls these).
create or replace function public.public_event_info(p_college_code text, p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'slug', e.slug, 'description', e.description, 'category', e.category,
    'starts_on', e.starts_on, 'ends_on', e.ends_on, 'venue', e.venue, 'status', e.status,
    'registration_opens_at', e.registration_opens_at, 'registration_closes_at', e.registration_closes_at,
    'contact_email', e.contact_email, 'contact_phone', e.contact_phone, 'website_url', e.website_url,
    'logo_path', e.logo_path, 'banner_path', e.banner_path, 'currency', e.currency, 'timezone', e.timezone,
    'social_links', e.social_links,
    'college', jsonb_build_object('name', c.name, 'code', c.code),
    'public_page', coalesce((s.registration_settings ->> 'public_page_enabled')::boolean, false),
    'allow_team_registrations', coalesce((s.registration_settings ->> 'allow_team_registrations')::boolean, true),
    'max_team_size', coalesce((s.registration_settings ->> 'max_team_size')::int, 6),
    'competitions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', k.code, 'name', k.name, 'category', k.category, 'description', k.description, 'fee', k.fee,
        'registration_type', k.registration_type, 'team_min', k.team_min, 'team_max', k.team_max,
        'starts_at', k.starts_at, 'venue', k.venue, 'rules_url', k.rules_url,
        'spots_left', case when k.capacity is null then null else greatest(k.capacity - (
          select count(*) from public.registration_items ri join public.registrations rg on rg.id = ri.registration_id
          where ri.competition_id = k.id and rg.status <> 'cancelled'), 0) end
      ) order by k.starts_at nulls last, k.name)
      from public.event_competitions k where k.event_id = e.id and k.is_active
    ), '[]'::jsonb)
  )
  from public.events e
  join public.colleges c on c.id = e.college_id
  left join public.event_settings s on s.event_id = e.id
  where lower(c.code) = lower(p_college_code) and e.slug = lower(p_slug) and e.status <> 'archived' and c.status = 'active'
$$;

create or replace function public.public_register(p_event uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not coalesce((select (registration_settings ->> 'public_page_enabled')::boolean from public.event_settings where event_id = p_event), false) then
    raise exception 'Online registration is not open for this event' using errcode = '22023';
  end if;
  v_result := app.create_registration(p_event, p_payload, 'website', null, false);
  -- Free registrations are confirmed straight away.
  if (v_result ->> 'amount')::numeric = 0 then
    update public.registrations set status = 'confirmed', confirmed_at = now() where id = (v_result ->> 'id')::uuid and status = 'pending';
    v_result := v_result || jsonb_build_object('status', 'confirmed');
  end if;
  return v_result;
end $$;

create or replace function public.public_ticket(p_code text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'registration_number', r.registration_number, 'participant_name', r.participant_name, 'email', r.email,
    'participant_college', r.participant_college, 'team_name', r.team_name, 'team_size', 1 + jsonb_array_length(r.team_members),
    'status', r.status, 'payment_status', r.payment_status, 'amount', r.payable_amount, 'amount_paid', r.amount_paid,
    'currency', r.currency, 'checked_in_at', r.checked_in_at, 'ticket_code', r.ticket_code, 'is_test', r.is_test,
    'items', coalesce((select jsonb_agg(i.item_name order by i.item_name) from public.registration_items i where i.registration_id = r.id), '[]'::jsonb),
    'event', jsonb_build_object('name', e.name, 'starts_on', e.starts_on, 'ends_on', e.ends_on, 'venue', e.venue,
                                'timezone', e.timezone, 'logo_path', e.logo_path, 'college', c.name, 'contact_email', e.contact_email)
  )
  from public.registrations r join public.events e on e.id = r.event_id join public.colleges c on c.id = e.college_id
  where r.ticket_code = upper(p_code)
$$;

-- 5. Gate check-in.
create or replace function app.can_check_in(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_event_permission(p_event, 'registrations.checkin')
      or app.has_event_permission(p_event, 'registrations.manage')
      or exists (select 1 from public.department_members m join public.departments d on d.id = m.department_id
                 where m.event_id = p_event and m.user_id = app.active_uid() and m.ended_at is null and m.status = 'active'
                   and d.kind = 'registration' and d.status = 'active')
$$;

create or replace function public.check_in_ticket(p_event uuid, p_code text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.registrations; v_result text;
begin
  if not app.can_check_in(p_event) then raise exception 'You are not allowed to check people in' using errcode = '42501'; end if;
  select * into r from public.registrations
   where event_id = p_event and ticket_code = upper(regexp_replace(coalesce(p_code, ''), '^.*/t/', '')) for update;
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if r.status <> 'confirmed' then
    v_result := case when r.status = 'cancelled' then 'cancelled' else 'not_confirmed' end;
  elsif r.checked_in_at is not null then
    v_result := 'already';
  else
    perform set_config('app.checkin_rpc', 'on', true);
    update public.registrations set checked_in_at = now(), checked_in_by = app.active_uid() where id = r.id
      returning * into r;
    perform set_config('app.checkin_rpc', 'off', true);
    v_result := 'ok';
  end if;
  return jsonb_build_object(
    'result', v_result, 'id', r.id, 'registration_number', r.registration_number, 'participant_name', r.participant_name,
    'participant_college', r.participant_college, 'team_name', r.team_name, 'status', r.status, 'payment_status', r.payment_status,
    'checked_in_at', r.checked_in_at, 'is_test', r.is_test,
    'items', coalesce((select jsonb_agg(i.item_name order by i.item_name) from public.registration_items i where i.registration_id = r.id), '[]'::jsonb)
  );
end $$;

create or replace function public.undo_check_in(p_registration uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.registrations where id = p_registration;
  if v_event is null then raise exception 'Registration not found' using errcode = 'P0002'; end if;
  if not app.can_check_in(v_event) then raise exception 'You are not allowed to change check-ins' using errcode = '42501'; end if;
  perform set_config('app.checkin_rpc', 'on', true);
  update public.registrations set checked_in_at = null, checked_in_by = null where id = p_registration;
  perform set_config('app.checkin_rpc', 'off', true);
end $$;

create or replace function public.checkin_overview(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_check_in(p_event) then raise exception 'You are not allowed to view check-ins' using errcode = '42501'; end if;
  return jsonb_build_object(
    'confirmed', (select count(*) from public.registrations where event_id = p_event and status = 'confirmed' and not is_test),
    'checked_in', (select count(*) from public.registrations where event_id = p_event and checked_in_at is not null and not is_test),
    'recent', coalesce((select jsonb_agg(x) from (
      select r.id, r.registration_number, r.participant_name, r.checked_in_at, p.full_name as checked_in_by
      from public.registrations r left join public.profiles p on p.id = r.checked_in_by
      where r.event_id = p_event and r.checked_in_at is not null order by r.checked_in_at desc limit 15) x), '[]'::jsonb)
  );
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.check_in_ticket(uuid, text)', 'public.undo_check_in(uuid)', 'public.checkin_overview(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.public_event_info(text, text)', 'public.public_register(uuid, jsonb)', 'public.public_ticket(text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
