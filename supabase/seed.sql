-- ============================================================================
-- EVENT APP — LOCAL DEVELOPMENT SEED ONLY (`supabase db reset`).
-- Never run against staging or production. Credentials below are throwaway
-- local values and grant nothing outside a developer's machine.
--
-- Creates one demo college + event and one account per role so every
-- permission level can be exercised:
--   superadmin@eventapp.local     Super Admin
--   collegeadmin@eventapp.local   College Admin  (Demo Institute of Technology)
--   eventadmin@eventapp.local     Event Admin    (Demo Fest)
--   finance@eventapp.local        Finance Head
--   registration@eventapp.local   Registration Head
--   media@eventapp.local          Media & PR Head
--   logistics@eventapp.local      Department Head (Logistics)
--   volunteer@eventapp.local      Team Member (Logistics)
-- Password for all: EventApp-dev-2026
-- ============================================================================

do $$
declare
  v_pw text := extensions.crypt('EventApp-dev-2026', extensions.gen_salt('bf'));
  v_users jsonb := '[
    ["superadmin@eventapp.local", "Dev Super Admin"], ["collegeadmin@eventapp.local", "Dev College Admin"],
    ["eventadmin@eventapp.local", "Dev Event Admin"], ["finance@eventapp.local", "Dev Finance Head"],
    ["registration@eventapp.local", "Dev Registration Head"], ["media@eventapp.local", "Dev Media Head"],
    ["logistics@eventapp.local", "Dev Logistics Head"], ["volunteer@eventapp.local", "Dev Volunteer"]
  ]';
  u jsonb;
  v_id uuid;
  v_college uuid;
  v_event uuid;
begin
  for u in select * from jsonb_array_elements(v_users) loop
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', u ->> 0, v_pw, now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u ->> 1), now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', u ->> 0, 'email_verified', true),
            'email', now(), now(), now());
  end loop;

  update public.profiles set is_super_admin = true where email = 'superadmin@eventapp.local';

  insert into public.colleges (name, code, city, state, email, status)
  values ('Demo Institute of Technology', 'DEMO-IT', 'Bengaluru', 'Karnataka', 'events@demo-it.local', 'active')
  returning id into v_college;

  insert into public.events (college_id, name, slug, category, starts_on, ends_on, venue, status, description)
  values (v_college, 'Demo Fest', 'demo-fest', 'cultural', current_date + 45, current_date + 47, 'Main Campus',
          'planning', 'Development-only demo event.')
  returning id into v_event;

  insert into public.college_members (college_id, user_id, role_id)
  select v_college, p.id, r.id from public.profiles p, public.roles r
  where p.email = 'collegeadmin@eventapp.local' and r.key = 'college_admin';

  insert into public.event_members (event_id, college_id, user_id, role_id)
  select v_event, v_college, p.id, r.id from public.profiles p, public.roles r
  where p.email = 'eventadmin@eventapp.local' and r.key = 'event_admin';

  insert into public.department_members (department_id, event_id, college_id, user_id, role_id, position)
  select d.id, v_event, v_college, p.id, r.id, x.position::public.department_position
  from (values
    ('finance@eventapp.local', 'Finance', 'finance_head', 'head'),
    ('registration@eventapp.local', 'Registration', 'registration_head', 'head'),
    ('media@eventapp.local', 'Media and PR', 'media_head', 'head'),
    ('logistics@eventapp.local', 'Logistics', 'department_head', 'head'),
    ('volunteer@eventapp.local', 'Logistics', 'team_member', 'member')
  ) as x(email, dept, role, position)
  join public.profiles p on p.email = x.email
  join public.departments d on d.event_id = v_event and d.name = x.dept
  join public.roles r on r.key = x.role;
end $$;
