-- ============================================================================
-- EVENT APP — Migration 28: feedback surveys
-- ============================================================================
-- questions: [{ id, type: 'rating' (1-5) | 'nps' (0-10) | 'choice' | 'text', label, options?, required }]

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 150),
  intro text check (intro is null or char_length(intro) <= 1000),
  audience text not null default 'participants' check (audience in ('participants', 'anyone')),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  public_token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index surveys_event_idx on public.surveys (event_id);

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  registration_id uuid references public.registrations (id) on delete set null,
  respondent_name text,
  answers jsonb not null,
  created_at timestamptz not null default now(),
  unique (survey_id, registration_id)
);
create index survey_responses_survey_idx on public.survey_responses (survey_id, created_at desc);

create table public.survey_invites (
  survey_id uuid not null references public.surveys (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (survey_id, registration_id)
);

alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_invites enable row level security;

create or replace function app.can_manage_surveys(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_event_permission(p_event, 'event.manage') or app.has_event_permission(p_event, 'registrations.manage')
$$;

create policy surveys_select on public.surveys for select to authenticated using (app.has_event_permission(event_id, 'event.view'));
create policy survey_responses_select on public.survey_responses for select to authenticated using (app.can_manage_surveys(event_id));
create policy survey_invites_select on public.survey_invites for select to authenticated
  using (exists (select 1 from public.surveys s where s.id = survey_id and app.can_manage_surveys(s.event_id)));
create trigger surveys_audit after insert or update or delete on public.surveys for each row execute function app.audit_row();

create or replace function app.validate_questions(p_questions jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare q jsonb;
begin
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 or jsonb_array_length(p_questions) > 30 then
    raise exception 'Add between 1 and 30 questions' using errcode = '22023';
  end if;
  for q in select * from jsonb_array_elements(p_questions) loop
    if coalesce(q ->> 'id', '') = '' or coalesce(trim(q ->> 'label'), '') = '' then raise exception 'Every question needs a label' using errcode = '22023'; end if;
    if (q ->> 'type') not in ('rating', 'nps', 'choice', 'text') then raise exception 'Unknown question type' using errcode = '22023'; end if;
    if (q ->> 'type') = 'choice' and (jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') < 2) then
      raise exception 'Choice questions need at least two options' using errcode = '22023';
    end if;
  end loop;
end $$;

create or replace function public.save_survey(p_event uuid, p_survey uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.events; v_id uuid; v_status text := coalesce(p_data ->> 'status', 'draft');
begin
  select * into e from public.events where id = p_event;
  if e.id is null then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not app.can_manage_surveys(p_event) then raise exception 'You are not allowed to manage surveys' using errcode = '42501'; end if;
  if v_status not in ('draft', 'open', 'closed') or coalesce(p_data ->> 'audience', 'participants') not in ('participants', 'anyone') then
    raise exception 'Invalid survey settings' using errcode = '22023';
  end if;
  perform app.validate_questions(p_data -> 'questions');
  if p_survey is null then
    insert into public.surveys (event_id, college_id, title, intro, audience, questions, status, created_by)
    values (p_event, e.college_id, left(trim(p_data ->> 'title'), 150), nullif(left(trim(p_data ->> 'intro'), 1000), ''),
            coalesce(p_data ->> 'audience', 'participants'), p_data -> 'questions', v_status, app.active_uid())
    returning id into v_id;
  else
    update public.surveys set title = left(trim(p_data ->> 'title'), 150), intro = nullif(left(trim(p_data ->> 'intro'), 1000), ''),
           audience = coalesce(p_data ->> 'audience', 'participants'), questions = p_data -> 'questions', status = v_status, updated_at = now()
     where id = p_survey and event_id = p_event returning id into v_id;
    if v_id is null then raise exception 'Survey not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.survey_results(p_survey uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.surveys; q jsonb; v_out jsonb := '[]'::jsonb; v_item jsonb;
begin
  select * into s from public.surveys where id = p_survey;
  if s.id is null then raise exception 'Survey not found' using errcode = 'P0002'; end if;
  if not app.can_manage_surveys(s.event_id) then raise exception 'You are not allowed to view survey results' using errcode = '42501'; end if;
  for q in select * from jsonb_array_elements(s.questions) loop
    if (q ->> 'type') in ('rating', 'nps') then
      select jsonb_build_object('average', round(avg((r.answers ->> (q ->> 'id'))::numeric), 2), 'count', count(r.answers ->> (q ->> 'id')),
               'distribution', coalesce((select jsonb_object_agg(v, c) from (select r2.answers ->> (q ->> 'id') v, count(*) c from public.survey_responses r2
                 where r2.survey_id = p_survey and r2.answers ? (q ->> 'id') group by 1) d), '{}'::jsonb),
               'nps', case when q ->> 'type' = 'nps' and count(r.answers ->> (q ->> 'id')) > 0 then round(100.0 * (
                 count(*) filter (where (r.answers ->> (q ->> 'id'))::int >= 9) - count(*) filter (where (r.answers ->> (q ->> 'id'))::int <= 6))
                 / count(r.answers ->> (q ->> 'id'))) end)
        into v_item from public.survey_responses r where r.survey_id = p_survey and r.answers ? (q ->> 'id');
    elsif q ->> 'type' = 'choice' then
      select jsonb_build_object('count', count(*), 'distribution', coalesce(jsonb_object_agg(v, c), '{}'::jsonb))
        into v_item from (select r.answers ->> (q ->> 'id') v, count(*) c from public.survey_responses r
                          where r.survey_id = p_survey and r.answers ? (q ->> 'id') group by 1) d;
    else
      select jsonb_build_object('count', count(*), 'answers', coalesce(jsonb_agg(x.t order by x.created_at desc), '[]'::jsonb))
        into v_item from (select r.answers ->> (q ->> 'id') t, r.created_at from public.survey_responses r
                          where r.survey_id = p_survey and coalesce(trim(r.answers ->> (q ->> 'id')), '') <> '' order by r.created_at desc limit 300) x;
    end if;
    v_out := v_out || jsonb_build_array(q || jsonb_build_object('result', v_item));
  end loop;
  return jsonb_build_object('responses', (select count(*) from public.survey_responses where survey_id = p_survey), 'questions', v_out);
end $$;

-- Public answering (service role only; /s/<token> calls these).
create or replace function public.public_survey(p_token text, p_ticket text default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'title', s.title, 'intro', s.intro, 'audience', s.audience, 'questions', s.questions, 'status', s.status,
    'event', jsonb_build_object('name', e.name, 'college', c.name),
    'respondent', (select jsonb_build_object('name', r.participant_name, 'answered', exists (select 1 from public.survey_responses x where x.survey_id = s.id and x.registration_id = r.id))
                   from public.registrations r where p_ticket is not null and r.event_id = s.event_id and r.ticket_code = upper(p_ticket))
  )
  from public.surveys s join public.events e on e.id = s.event_id join public.colleges c on c.id = e.college_id
  where s.public_token = lower(p_token) and s.status <> 'draft'
$$;

create or replace function public.submit_survey_response(p_token text, p_ticket text, p_name text, p_answers jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.surveys; q jsonb; v_reg uuid; v_val text; v_clean jsonb := '{}'::jsonb;
begin
  select * into s from public.surveys where public_token = lower(p_token);
  if s.id is null or s.status <> 'open' then raise exception 'This survey is not accepting responses' using errcode = '22023'; end if;
  if nullif(p_ticket, '') is not null then
    select id into v_reg from public.registrations where event_id = s.event_id and ticket_code = upper(p_ticket);
    if v_reg is null then raise exception 'This survey link is not valid' using errcode = '22023'; end if;
  elsif s.audience = 'participants' then
    raise exception 'Please use the personal link from your email' using errcode = '22023';
  end if;
  for q in select * from jsonb_array_elements(s.questions) loop
    v_val := nullif(trim(p_answers ->> (q ->> 'id')), '');
    if v_val is null then
      if coalesce((q ->> 'required')::boolean, false) then raise exception 'Please answer: %', q ->> 'label' using errcode = '22023'; end if;
      continue;
    end if;
    if q ->> 'type' = 'rating' and (v_val !~ '^[1-5]$') then raise exception 'Invalid rating' using errcode = '22023'; end if;
    if q ->> 'type' = 'nps' and (v_val !~ '^([0-9]|10)$') then raise exception 'Invalid score' using errcode = '22023'; end if;
    if q ->> 'type' = 'choice' and not (q -> 'options') ? v_val then raise exception 'Invalid choice' using errcode = '22023'; end if;
    v_clean := v_clean || jsonb_build_object(q ->> 'id', left(v_val, 2000));
  end loop;
  insert into public.survey_responses (survey_id, event_id, college_id, registration_id, respondent_name, answers)
  values (s.id, s.event_id, s.college_id, v_reg, nullif(left(trim(p_name), 160), ''), v_clean);
exception when unique_violation then
  raise exception 'You have already answered this survey. Thank you!' using errcode = '22023';
end $$;

-- Participants who haven't been invited yet (for emailing personal links).
create or replace function public.survey_invite_batch(p_survey uuid, p_limit int default 80)
returns table (registration_id uuid, name text, email text, ticket_code text)
language plpgsql security definer set search_path = '' as $$
declare s public.surveys;
begin
  select * into s from public.surveys where id = p_survey;
  if s.id is null then raise exception 'Survey not found' using errcode = 'P0002'; end if;
  if not app.can_manage_surveys(s.event_id) then raise exception 'You are not allowed to send survey invitations' using errcode = '42501'; end if;
  if s.status <> 'open' then raise exception 'Open the survey before inviting people' using errcode = '22023'; end if;
  return query
    select r.id, r.participant_name, r.email, r.ticket_code from public.registrations r
    where r.event_id = s.event_id and r.status = 'confirmed' and not r.is_test
      and not exists (select 1 from public.survey_invites i where i.survey_id = s.id and i.registration_id = r.id)
    order by r.checked_in_at desc nulls last, r.created_at limit least(greatest(p_limit, 1), 200);
end $$;

create or replace function public.mark_survey_invited(p_survey uuid, p_registrations uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.surveys s where s.id = p_survey and app.can_manage_surveys(s.event_id)) then
    raise exception 'You are not allowed to send survey invitations' using errcode = '42501';
  end if;
  insert into public.survey_invites (survey_id, registration_id) select p_survey, unnest(p_registrations) on conflict do nothing;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.save_survey(uuid, uuid, jsonb)', 'public.survey_results(uuid)', 'public.survey_invite_batch(uuid, integer)', 'public.mark_survey_invited(uuid, uuid[])'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.public_survey(text, text)', 'public.submit_survey_response(text, text, text, jsonb)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
