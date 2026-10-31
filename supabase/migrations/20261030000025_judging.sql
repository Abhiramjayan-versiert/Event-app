-- ============================================================================
-- EVENT APP — Migration 25: judging and results
-- ============================================================================
-- Organisers (judging.manage, or the competition's department leads) set
-- criteria and appoint judges. Judges score confirmed entrants of their
-- competitions. Scores lock when results are published; published results
-- appear on the public event page and drive winner certificates.

insert into public.permissions (key, module, name, scope, sort_order, description)
values ('judging.manage', 'judging', 'Manage judging', 'event', 67, 'Set criteria, appoint judges and publish competition results')
on conflict (key) do nothing;
select app.grant_permissions(r, array['judging.manage']) from unnest(array['college_admin', 'event_admin']) r;

alter table public.event_competitions add column results_published_at timestamptz;

create table public.judging_criteria (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.event_competitions (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  max_score numeric(6, 2) not null default 10 check (max_score > 0 and max_score <= 1000),
  weight numeric(6, 2) not null default 1 check (weight > 0 and weight <= 100),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index judging_criteria_comp_idx on public.judging_criteria (competition_id, sort_order);

create table public.competition_judges (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.event_competitions (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (competition_id, user_id)
);
create index competition_judges_user_idx on public.competition_judges (user_id);

create table public.judging_scores (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.event_competitions (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  criterion_id uuid not null references public.judging_criteria (id) on delete cascade,
  judge_id uuid not null references public.profiles (id) on delete cascade,
  score numeric(7, 2) not null check (score >= 0),
  comment text check (comment is null or char_length(comment) <= 1000),
  updated_at timestamptz not null default now(),
  unique (criterion_id, registration_id, judge_id)
);
create index judging_scores_comp_idx on public.judging_scores (competition_id, registration_id);

create table public.competition_results (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.event_competitions (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  position int not null check (position between 1 and 50),
  title text not null check (char_length(title) between 1 and 80),
  total_score numeric(10, 2),
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (competition_id, registration_id)
);
create index competition_results_event_idx on public.competition_results (event_id);

alter table public.judging_criteria enable row level security;
alter table public.competition_judges enable row level security;
alter table public.judging_scores enable row level security;
alter table public.competition_results enable row level security;

create or replace function app.can_manage_judging(p_competition uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.event_competitions k where k.id = p_competition and (
      app.has_event_permission(k.event_id, 'judging.manage')
      or (k.department_id is not null and app.has_department_permission(k.department_id, 'department.manage'))
    )
  )
$$;

create or replace function app.is_judge(p_competition uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.competition_judges j where j.competition_id = p_competition and j.user_id = app.active_uid())
$$;

-- Reads: event members see criteria, judges and published results; scores are
-- visible to their judge and to judging managers. All writes go through RPCs.
create policy judging_criteria_select on public.judging_criteria for select to authenticated
  using (app.has_event_permission(event_id, 'event.view') or app.is_judge(competition_id));
create policy competition_judges_select on public.competition_judges for select to authenticated
  using (user_id = (select auth.uid()) or app.has_event_permission(event_id, 'event.view'));
create policy judging_scores_select on public.judging_scores for select to authenticated
  using (judge_id = (select auth.uid()) or app.can_manage_judging(competition_id));
create policy competition_results_select on public.competition_results for select to authenticated
  using (app.has_event_permission(event_id, 'event.view'));
revoke insert, update, delete on public.judging_criteria, public.competition_judges, public.judging_scores, public.competition_results from authenticated, anon;

create or replace function public.set_judging_setup(p_competition uuid, p_criteria jsonb, p_judges uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare k public.event_competitions; c jsonb; i int := 0; v_keep uuid[] := '{}'; v_id uuid;
begin
  select * into k from public.event_competitions where id = p_competition;
  if k.id is null then raise exception 'Competition not found' using errcode = 'P0002'; end if;
  if not app.can_manage_judging(p_competition) then raise exception 'You are not allowed to manage judging for this competition' using errcode = '42501'; end if;
  if k.results_published_at is not null then raise exception 'Results are published. Unpublish them to change the setup.' using errcode = '22023'; end if;
  if jsonb_typeof(p_criteria) <> 'array' or jsonb_array_length(p_criteria) = 0 then
    raise exception 'Add at least one criterion' using errcode = '22023';
  end if;

  for c in select * from jsonb_array_elements(p_criteria) loop
    i := i + 1;
    if nullif(c ->> 'id', '') is not null then
      update public.judging_criteria set name = left(trim(c ->> 'name'), 120), max_score = (c ->> 'max_score')::numeric,
             weight = coalesce((c ->> 'weight')::numeric, 1), sort_order = i
       where id = (c ->> 'id')::uuid and competition_id = p_competition returning id into v_id;
    else
      insert into public.judging_criteria (competition_id, event_id, college_id, name, max_score, weight, sort_order)
      values (p_competition, k.event_id, k.college_id, left(trim(c ->> 'name'), 120), (c ->> 'max_score')::numeric, coalesce((c ->> 'weight')::numeric, 1), i)
      returning id into v_id;
    end if;
    if v_id is not null then v_keep := v_keep || v_id; end if;
  end loop;
  delete from public.judging_criteria where competition_id = p_competition and not (id = any(v_keep));

  delete from public.competition_judges where competition_id = p_competition and not (user_id = any(coalesce(p_judges, '{}')));
  insert into public.competition_judges (competition_id, event_id, college_id, user_id, assigned_by)
  select p_competition, k.event_id, k.college_id, u, app.active_uid()
  from unnest(coalesce(p_judges, '{}')) u
  where exists (select 1 from public.profiles p where p.id = u and p.status = 'active')
  on conflict (competition_id, user_id) do nothing;

  perform app.notify(j.user_id, k.event_id, 'judging.assigned', 'You are judging ' || k.name, 'Open Judging to score the entrants.',
                     '/events/' || k.event_id || '/judging/' || k.id)
  from public.competition_judges j where j.competition_id = p_competition and j.created_at > now() - interval '5 seconds';
end $$;

-- Entrants: confirmed (non-test) registrations entered in the competition.
create or replace function app.competition_entrants(p_competition uuid)
returns table (registration_id uuid, registration_number text, name text, college text, checked_in boolean)
language sql stable security definer set search_path = '' as $$
  select distinct r.id, r.registration_number, coalesce(nullif(r.team_name, ''), r.participant_name), r.participant_college, r.checked_in_at is not null
  from public.registration_items i join public.registrations r on r.id = i.registration_id
  where i.competition_id = p_competition and r.status = 'confirmed' and not r.is_test
$$;

create or replace function public.judging_sheet(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare k public.event_competitions; v_manager boolean; v_judge boolean;
begin
  select * into k from public.event_competitions where id = p_competition;
  if k.id is null then raise exception 'Competition not found' using errcode = 'P0002'; end if;
  v_manager := app.can_manage_judging(p_competition);
  v_judge := app.is_judge(p_competition);
  if not (v_manager or v_judge) then raise exception 'You are not a judge or organiser of this competition' using errcode = '42501'; end if;
  return jsonb_build_object(
    'competition', jsonb_build_object('id', k.id, 'name', k.name, 'code', k.code, 'event_id', k.event_id, 'results_published_at', k.results_published_at),
    'can_manage', v_manager, 'is_judge', v_judge,
    'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'max_score', c.max_score, 'weight', c.weight) order by c.sort_order)
                          from public.judging_criteria c where c.competition_id = p_competition), '[]'::jsonb),
    'judges', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.full_name, 'email', p.email) order by p.full_name)
                        from public.competition_judges j join public.profiles p on p.id = j.user_id where j.competition_id = p_competition), '[]'::jsonb),
    'entrants', coalesce((select jsonb_agg(to_jsonb(e) order by e.registration_number) from app.competition_entrants(p_competition) e), '[]'::jsonb),
    'my_scores', coalesce((select jsonb_agg(jsonb_build_object('registration_id', s.registration_id, 'criterion_id', s.criterion_id, 'score', s.score, 'comment', s.comment))
                           from public.judging_scores s where s.competition_id = p_competition and s.judge_id = app.active_uid()), '[]'::jsonb)
  );
end $$;

create or replace function public.submit_scores(p_competition uuid, p_registration uuid, p_scores jsonb, p_comment text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare k public.event_competitions; s jsonb; c public.judging_criteria;
begin
  select * into k from public.event_competitions where id = p_competition;
  if k.id is null then raise exception 'Competition not found' using errcode = 'P0002'; end if;
  if not app.is_judge(p_competition) then raise exception 'Only judges of this competition can score' using errcode = '42501'; end if;
  if k.results_published_at is not null then raise exception 'Results are published; scores are locked' using errcode = '22023'; end if;
  if not exists (select 1 from app.competition_entrants(p_competition) e where e.registration_id = p_registration) then
    raise exception 'This entrant is not in the competition' using errcode = '22023';
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) loop
    select * into c from public.judging_criteria where id = (s ->> 'criterion_id')::uuid and competition_id = p_competition;
    if c.id is null then raise exception 'Unknown criterion' using errcode = '22023'; end if;
    if (s ->> 'score') is null then
      delete from public.judging_scores where criterion_id = c.id and registration_id = p_registration and judge_id = app.active_uid();
      continue;
    end if;
    if (s ->> 'score')::numeric < 0 or (s ->> 'score')::numeric > c.max_score then
      raise exception '% must be between 0 and %', c.name, c.max_score using errcode = '22023';
    end if;
    insert into public.judging_scores (competition_id, event_id, college_id, registration_id, criterion_id, judge_id, score, comment)
    values (p_competition, k.event_id, k.college_id, p_registration, c.id, app.active_uid(), (s ->> 'score')::numeric, nullif(left(trim(p_comment), 1000), ''))
    on conflict (criterion_id, registration_id, judge_id) do update set score = excluded.score, comment = excluded.comment, updated_at = now();
  end loop;
end $$;

-- Weighted total per entrant: sum over criteria of weight × (average judge score ÷ max) × 100 ÷ total weight.
create or replace function public.competition_leaderboard(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_judges int;
begin
  if not app.can_manage_judging(p_competition) then raise exception 'Only organisers can see the leaderboard' using errcode = '42501'; end if;
  select count(*) into v_judges from public.competition_judges where competition_id = p_competition;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.total desc nulls last, x.registration_number)
    from (
      select e.registration_id, e.registration_number, e.name, e.college, e.checked_in,
             round(sum(c.weight * coalesce(a.avg_score, 0) / c.max_score) * 100 / nullif(sum(c.weight), 0), 2) as total,
             (select count(distinct s.judge_id) from public.judging_scores s where s.competition_id = p_competition and s.registration_id = e.registration_id) as judges_scored,
             v_judges as judges_total,
             r.position, r.title
      from app.competition_entrants(p_competition) e
      cross join public.judging_criteria c
      left join lateral (select avg(s.score) avg_score from public.judging_scores s where s.criterion_id = c.id and s.registration_id = e.registration_id) a on true
      left join public.competition_results r on r.competition_id = p_competition and r.registration_id = e.registration_id
      where c.competition_id = p_competition
      group by e.registration_id, e.registration_number, e.name, e.college, e.checked_in, r.position, r.title
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.publish_results(p_competition uuid, p_results jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare k public.event_competitions; x jsonb; v_board jsonb;
begin
  select * into k from public.event_competitions where id = p_competition for update;
  if k.id is null then raise exception 'Competition not found' using errcode = 'P0002'; end if;
  if not app.can_manage_judging(p_competition) then raise exception 'Only organisers can publish results' using errcode = '42501'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then raise exception 'Choose at least one winner' using errcode = '22023'; end if;
  v_board := public.competition_leaderboard(p_competition);
  delete from public.competition_results where competition_id = p_competition;
  for x in select * from jsonb_array_elements(p_results) loop
    if not exists (select 1 from app.competition_entrants(p_competition) e where e.registration_id = (x ->> 'registration_id')::uuid) then
      raise exception 'A winner is not an entrant of this competition' using errcode = '22023';
    end if;
    insert into public.competition_results (competition_id, event_id, college_id, registration_id, position, title, total_score, published_by)
    values (p_competition, k.event_id, k.college_id, (x ->> 'registration_id')::uuid, (x ->> 'position')::int, left(trim(x ->> 'title'), 80),
            (select (b ->> 'total')::numeric from jsonb_array_elements(v_board) b where b ->> 'registration_id' = x ->> 'registration_id'), app.active_uid());
  end loop;
  update public.event_competitions set results_published_at = now() where id = p_competition;
  perform app.log_activity(k.event_id, k.department_id, 'results.published', 'Results published: ' || k.name, 'event_competitions', k.id);
end $$;

create or replace function public.unpublish_results(p_competition uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_manage_judging(p_competition) then raise exception 'Only organisers can unpublish results' using errcode = '42501'; end if;
  update public.event_competitions set results_published_at = null where id = p_competition;
end $$;

-- Published results on the public page.
create or replace function public.public_results(p_event uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('competition', k.name, 'results', (
      select jsonb_agg(jsonb_build_object('position', r.position, 'title', r.title,
                       'name', coalesce(nullif(g.team_name, ''), g.participant_name), 'college', g.participant_college) order by r.position)
      from public.competition_results r join public.registrations g on g.id = r.registration_id where r.competition_id = k.id))
    order by k.name), '[]'::jsonb)
  from public.event_competitions k
  where k.event_id = p_event and k.results_published_at is not null
$$;

do $$
declare f text;
begin
  foreach f in array array['public.set_judging_setup(uuid, jsonb, uuid[])', 'public.judging_sheet(uuid)', 'public.submit_scores(uuid, uuid, jsonb, text)',
                           'public.competition_leaderboard(uuid)', 'public.publish_results(uuid, jsonb)', 'public.unpublish_results(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke execute on function public.public_results(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.public_results(uuid) to service_role';
end $$;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;

-- Audit judging changes like every other business table.
create trigger judging_scores_audit after insert or update or delete on public.judging_scores for each row execute function app.audit_row();
create trigger competition_results_audit after insert or update or delete on public.competition_results for each row execute function app.audit_row();
create trigger competition_judges_audit after insert or update or delete on public.competition_judges for each row execute function app.audit_row();
