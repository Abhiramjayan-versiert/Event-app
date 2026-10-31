-- ============================================================================
-- EVENT APP — Migration 26: certificates
-- ============================================================================
-- Participation and winner certificates with a public verification code.
-- Issued in bulk by registration managers; each team member gets their own.

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  kind text not null check (kind in ('participation', 'winner')),
  title text not null check (char_length(title) between 1 and 160),
  recipient_name text not null check (char_length(recipient_name) between 1 and 160),
  recipient_email text,
  competition_name text,
  code text not null unique default upper(encode(extensions.gen_random_bytes(6), 'hex')),
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles (id) on delete set null,
  emailed_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  unique (registration_id, title, recipient_name)
);
create index certificates_event_idx on public.certificates (event_id, issued_at desc);

alter table public.certificates enable row level security;
create policy certificates_select on public.certificates for select to authenticated
  using (app.has_event_permission(event_id, 'registrations.view'));
create trigger certificates_audit after insert or update or delete on public.certificates for each row execute function app.audit_row();

-- Issue certificates in bulk. kind = 'participation' (confirmed registrations,
-- optionally only those checked in) or 'winner' (published results).
create or replace function public.issue_certificates(p_event uuid, p_kind text, p_only_checked_in boolean default true)
returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.events; v_count int := 0; v_n int;
begin
  select * into e from public.events where id = p_event;
  if e.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(p_event, 'registrations.manage') then
    raise exception 'You are not allowed to issue certificates' using errcode = '42501';
  end if;

  if p_kind = 'participation' then
    insert into public.certificates (event_id, college_id, registration_id, kind, title, recipient_name, recipient_email, competition_name, issued_by)
    select r.id_event, e.college_id, r.reg_id, 'participation', 'Certificate of Participation', r.person, r.email,
           (select string_agg(i.item_name, ', ' order by i.item_name) from public.registration_items i where i.registration_id = r.reg_id), app.active_uid()
    from (
      select g.event_id id_event, g.id reg_id, g.participant_name person, g.email
      from public.registrations g
      where g.event_id = p_event and g.status = 'confirmed' and not g.is_test and (not p_only_checked_in or g.checked_in_at is not null)
      union all
      select g.event_id, g.id, trim(m ->> 'name'), nullif(trim(m ->> 'email'), '')
      from public.registrations g cross join lateral jsonb_array_elements(g.team_members) m
      where g.event_id = p_event and g.status = 'confirmed' and not g.is_test and (not p_only_checked_in or g.checked_in_at is not null)
        and coalesce(trim(m ->> 'name'), '') <> ''
    ) r
    on conflict (registration_id, title, recipient_name) do nothing;
    get diagnostics v_count = row_count;
  elsif p_kind = 'winner' then
    insert into public.certificates (event_id, college_id, registration_id, kind, title, recipient_name, recipient_email, competition_name, issued_by)
    select p_event, e.college_id, x.reg_id, 'winner', x.title || ' · ' || x.comp, x.person, x.email, x.comp, app.active_uid()
    from (
      select res.registration_id reg_id, res.title, k.name comp, g.participant_name person, g.email
      from public.competition_results res join public.event_competitions k on k.id = res.competition_id
      join public.registrations g on g.id = res.registration_id
      where res.event_id = p_event and k.results_published_at is not null
      union all
      select res.registration_id, res.title, k.name, trim(m ->> 'name'), nullif(trim(m ->> 'email'), '')
      from public.competition_results res join public.event_competitions k on k.id = res.competition_id
      join public.registrations g on g.id = res.registration_id cross join lateral jsonb_array_elements(g.team_members) m
      where res.event_id = p_event and k.results_published_at is not null and coalesce(trim(m ->> 'name'), '') <> ''
    ) x
    on conflict (registration_id, title, recipient_name) do nothing;
    get diagnostics v_count = row_count;
  else
    raise exception 'Unknown certificate type' using errcode = '22023';
  end if;

  if v_count > 0 then
    perform app.log_activity(p_event, null, 'certificates.issued', v_count || ' ' || p_kind || ' certificate(s) issued', 'certificates', null, 'registrations.view');
  end if;
  return v_count;
end $$;

create or replace function public.set_certificate_revoked(p_certificate uuid, p_revoked boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.certificates where id = p_certificate;
  if v_event is null then raise exception 'Certificate not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(v_event, 'registrations.manage') then raise exception 'You are not allowed to change certificates' using errcode = '42501'; end if;
  update public.certificates
     set revoked_at = case when p_revoked then now() else null end,
         revoked_reason = case when p_revoked then nullif(left(trim(p_reason), 300), '') else null end
   where id = p_certificate;
end $$;

create or replace function public.mark_certificates_emailed(p_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.certificates c set emailed_at = now()
   where c.id = any(p_ids) and app.has_event_permission(c.event_id, 'registrations.manage');
end $$;

-- Public verification (service role only; the /c/<code> page calls it).
create or replace function public.public_certificate(p_code text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', c.code, 'kind', c.kind, 'title', c.title, 'recipient_name', c.recipient_name, 'competition_name', c.competition_name,
    'issued_at', c.issued_at, 'revoked', c.revoked_at is not null,
    'event', jsonb_build_object('name', e.name, 'starts_on', e.starts_on, 'ends_on', e.ends_on, 'logo_path', e.logo_path, 'college', k.name,
                                'certificate', coalesce(s.branding -> 'certificate', '{}'::jsonb))
  )
  from public.certificates c join public.events e on e.id = c.event_id join public.colleges k on k.id = e.college_id
  left join public.event_settings s on s.event_id = e.id
  where c.code = upper(p_code)
$$;

do $$
declare f text;
begin
  foreach f in array array['public.issue_certificates(uuid, text, boolean)', 'public.set_certificate_revoked(uuid, boolean, text)', 'public.mark_certificates_emailed(uuid[])'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke execute on function public.public_certificate(text) from public, anon, authenticated';
  execute 'grant execute on function public.public_certificate(text) to service_role';
end $$;
revoke insert, update, delete on public.certificates from authenticated, anon;
