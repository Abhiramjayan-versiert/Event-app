-- ============================================================================
-- EVENT APP — Migration 5: Application RPCs, storage and realtime
-- ============================================================================

create or replace function app.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Access summary for the signed-in user (drives navigation & switchers)
-- ---------------------------------------------------------------------------
create or replace function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', p.id,
    'email', p.email,
    'full_name', p.full_name,
    'avatar_path', p.avatar_path,
    'status', p.status,
    'is_super_admin', p.is_super_admin and p.status = 'active',
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'code', c.code, 'status', c.status, 'logo_path', c.logo_path,
        'roles', (select coalesce(jsonb_agg(distinct r.key), '[]'::jsonb)
                  from public.college_members cm join public.roles r on r.id = cm.role_id
                  where cm.college_id = c.id and cm.user_id = v_uid and cm.status = 'active' and cm.ended_at is null)
      ) order by c.name)
      from public.colleges c
      where c.id = any(app.visible_college_ids())
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'slug', e.slug, 'status', e.status, 'college_id', e.college_id,
        'college_name', c.name, 'starts_on', e.starts_on, 'ends_on', e.ends_on, 'logo_path', e.logo_path,
        'roles', (
          select coalesce(jsonb_agg(x order by x ->> 'role_name'), '[]'::jsonb) from (
            select jsonb_build_object('role_key', r.key, 'role_name', r.name, 'department_id', null,
                                      'department_name', null, 'position', null) as x
            from public.event_members em join public.roles r on r.id = em.role_id
            where em.event_id = e.id and em.user_id = v_uid and em.status = 'active' and em.ended_at is null
            union all
            select jsonb_build_object('role_key', r.key, 'role_name', r.name, 'department_id', d.id,
                                      'department_name', d.name, 'position', dm.position)
            from public.department_members dm
            join public.roles r on r.id = dm.role_id
            join public.departments d on d.id = dm.department_id
            where dm.event_id = e.id and dm.user_id = v_uid and dm.status = 'active' and dm.ended_at is null
          ) s
        )
      ) order by e.starts_on desc)
      from public.events e
      join public.colleges c on c.id = e.college_id
      where e.id = any(app.event_ids_with_permission('event.view'))
    ), '[]'::jsonb)
  ) into v_result
  from public.profiles p
  where p.id = v_uid;

  return v_result;
end $$;

-- Effective permissions within one event: event-wide keys plus per-department keys.
create or replace function public.my_event_permissions(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.active_uid();
  v_event_perms text[];
  v_dept jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('event', '[]'::jsonb, 'departments', '{}'::jsonb);
  end if;

  if app.is_super_admin() then
    select array_agg(key order by key) into v_event_perms from public.permissions where scope <> 'college';
    return jsonb_build_object('event', to_jsonb(v_event_perms), 'departments', '{}'::jsonb, 'all_departments', true);
  end if;

  select coalesce(array_agg(distinct pm.key order by pm.key), '{}') into v_event_perms
  from public.permissions pm
  join public.role_permissions rp on rp.permission_id = pm.id
  where rp.role_id in (
      select cm.role_id from public.college_members cm join public.events e on e.college_id = cm.college_id
      where e.id = p_event and cm.user_id = v_uid and cm.status = 'active' and cm.ended_at is null
      union all
      select em.role_id from public.event_members em
      where em.event_id = p_event and em.user_id = v_uid and em.status = 'active' and em.ended_at is null
    )
    or (pm.scope <> 'department' and rp.role_id in (
      select dm.role_id from public.department_members dm
      where dm.event_id = p_event and dm.user_id = v_uid and dm.status = 'active' and dm.ended_at is null
    ));

  select coalesce(jsonb_object_agg(x.department_id, x.perms), '{}'::jsonb) into v_dept
  from (
    select dm.department_id, jsonb_agg(distinct pm.key) as perms
    from public.department_members dm
    join public.role_permissions rp on rp.role_id = dm.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where dm.event_id = p_event and dm.user_id = v_uid and dm.status = 'active' and dm.ended_at is null
    group by dm.department_id
  ) x;

  -- Event-wide department permissions (e.g. event admins) apply to every department.
  return jsonb_build_object(
    'event', to_jsonb(v_event_perms),
    'departments', v_dept,
    'all_departments', 'department.view' = any(v_event_perms)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Global (Super Admin / College Admin) dashboard
-- ---------------------------------------------------------------------------
create or replace function public.global_dashboard(
  p_college uuid default null,
  p_event uuid default null,
  p_status public.event_status default null,
  p_from date default null,
  p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_super boolean := app.is_super_admin();
  v_colleges uuid[];
  v_events uuid[];
  v_from date := coalesce(p_from, current_date - 29);
  v_to date := coalesce(p_to, current_date);
  v_result jsonb;
begin
  if app.active_uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_super then
    select coalesce(array_agg(id), '{}') into v_colleges from public.colleges
    where p_college is null or id = p_college;
  else
    v_colleges := app.college_ids_with_permission('college.view');
    if p_college is not null then
      v_colleges := array(select unnest(v_colleges) intersect select p_college);
    end if;
  end if;

  if coalesce(array_length(v_colleges, 1), 0) = 0 and not v_super then
    raise exception 'Not authorized to view global analytics' using errcode = '42501';
  end if;

  select coalesce(array_agg(e.id), '{}') into v_events
  from public.events e
  where e.college_id = any(v_colleges)
    and (p_event is null or e.id = p_event)
    and (p_status is null or e.status = p_status);

  with
  ev as (select e.*, c.name as college_name from public.events e join public.colleges c on c.id = e.college_id where e.id = any(v_events)),
  reg as (
    select r.* from public.registrations r
    where r.event_id = any(v_events) and r.created_at::date between v_from and v_to
  ),
  ledger as (
    select t.* from public.financial_transactions t
    where t.event_id = any(v_events) and t.status = 'verified' and t.occurred_on between v_from and v_to
  ),
  days as (select generate_series(v_from, v_to, interval '1 day')::date as d)
  select jsonb_build_object(
    'scope', jsonb_build_object('is_super_admin', v_super, 'college_count', coalesce(array_length(v_colleges, 1), 0),
                                'event_count', coalesce(array_length(v_events, 1), 0), 'from', v_from, 'to', v_to),
    'cards', jsonb_build_object(
      'total_colleges', (select count(*) from public.colleges where id = any(v_colleges)),
      'active_colleges', (select count(*) from public.colleges where id = any(v_colleges) and status = 'active'),
      'total_events', (select count(*) from ev),
      'upcoming_events', (select count(*) from ev where status in ('planning', 'registration_open', 'registration_closed', 'upcoming') and ends_on >= current_date),
      'live_events', (select count(*) from ev where status = 'live'),
      'completed_events', (select count(*) from ev where status in ('completed', 'archived')),
      'total_participants', (select count(*) from public.registrations r where r.event_id = any(v_events) and r.status <> 'cancelled'),
      'total_users', case when v_super then (select count(*) from public.profiles)
                          else (select count(distinct u) from (
                                  select cm.user_id u from public.college_members cm where cm.college_id = any(v_colleges) and cm.ended_at is null
                                  union select em.user_id from public.event_members em where em.event_id = any(v_events) and em.ended_at is null
                                  union select dm.user_id from public.department_members dm where dm.event_id = any(v_events) and dm.ended_at is null) s) end
    ),
    'finance', app.financial_summary(v_events, p_from, p_to),
    'registration_trend', (
      select coalesce(jsonb_agg(jsonb_build_object('date', days.d, 'registrations', coalesce(x.n, 0), 'confirmed', coalesce(x.c, 0)) order by days.d), '[]'::jsonb)
      from days left join (
        select created_at::date as d, count(*) as n, count(*) filter (where status = 'confirmed') as c from reg group by 1
      ) x on x.d = days.d
    ),
    'revenue_by_college', (
      select coalesce(jsonb_agg(jsonb_build_object('college', c.name, 'code', c.code, 'income', coalesce(x.income, 0), 'expenditure', coalesce(x.expense, 0)) order by coalesce(x.income, 0) desc), '[]'::jsonb)
      from public.colleges c
      left join (
        select college_id,
               sum(amount) filter (where kind = 'income' or (kind = 'adjustment' and direction = 'in')) as income,
               sum(amount) filter (where kind in ('expense', 'refund') or (kind = 'adjustment' and direction = 'out')) as expense
        from ledger group by college_id
      ) x on x.college_id = c.id
      where c.id = any(v_colleges)
    ),
    'revenue_by_event', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.income desc), '[]'::jsonb) from (
        select ev.id, ev.name as event, ev.college_name as college,
               coalesce(sum(l.amount) filter (where l.kind = 'income'), 0) as income,
               coalesce(sum(l.amount) filter (where l.kind = 'income' and l.category in ('online_registration', 'offline_registration')), 0) as registration_income,
               coalesce(sum(l.amount) filter (where l.kind = 'income' and l.category = 'sponsorship'), 0) as sponsorship_income,
               coalesce(sum(l.amount) filter (where l.kind in ('expense', 'refund')), 0) as expenditure
        from ev left join ledger l on l.event_id = ev.id
        group by ev.id, ev.name, ev.college_name
        order by income desc limit 12
      ) s
    ),
    'income_vs_expenditure', (
      select coalesce(jsonb_agg(jsonb_build_object('date', days.d, 'income', coalesce(x.income, 0), 'expenditure', coalesce(x.expense, 0)) order by days.d), '[]'::jsonb)
      from days left join (
        select occurred_on as d,
               sum(amount) filter (where kind = 'income' or (kind = 'adjustment' and direction = 'in')) as income,
               sum(amount) filter (where kind in ('expense', 'refund') or (kind = 'adjustment' and direction = 'out')) as expense
        from ledger group by 1
      ) x on x.d = days.d
    ),
    'sponsorship_by_event', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.committed desc), '[]'::jsonb) from (
        select ev.name as event,
               coalesce(sum(d.agreed_amount) filter (where d.stage in ('confirmed', 'partially_paid', 'fully_paid')), 0) as committed,
               coalesce(sum(d.received_amount), 0) as received,
               count(d.id) as deals
        from ev left join public.sponsorship_deals d on d.event_id = ev.id
        group by ev.id, ev.name
        having count(d.id) > 0
        order by committed desc limit 12
      ) s
    ),
    'activity_trend', (
      select coalesce(jsonb_agg(jsonb_build_object('date', days.d, 'activities', coalesce(x.n, 0)) order by days.d), '[]'::jsonb)
      from days left join (
        select a.created_at::date d, count(*) n from public.activity_log a
        where a.event_id = any(v_events) and a.created_at::date between v_from and v_to group by 1
      ) x on x.d = days.d
    ),
    'department_performance', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.total desc), '[]'::jsonb) from (
        select d.name as department,
               count(t.id) as total,
               count(t.id) filter (where t.status = 'completed') as completed,
               count(t.id) filter (where t.status <> 'completed' and t.due_at < now()) as overdue
        from public.departments d
        join public.tasks t on t.department_id = d.id
        where d.event_id = any(v_events)
        group by d.name
        order by count(t.id) desc limit 12
      ) s
    ),
    'events_by_college', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.total desc), '[]'::jsonb) from (
        select c.name as college,
               count(e.id) as total,
               count(e.id) filter (where e.status = 'live') as live,
               count(e.id) filter (where e.status in ('planning', 'registration_open', 'registration_closed', 'upcoming')) as upcoming,
               count(e.id) filter (where e.status in ('completed', 'archived')) as completed
        from public.colleges c left join ev e on e.college_id = c.id
        where c.id = any(v_colleges)
        group by c.id, c.name
      ) s
    ),
    'recent_colleges', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select id, name, code, city, status, created_at from public.colleges
        where id = any(v_colleges) order by created_at desc limit 5
      ) s
    ),
    'recent_events', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select id, name, college_name, status, starts_on, ends_on, created_at from ev order by created_at desc limit 5
      ) s
    ),
    'upcoming_events', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select id, name, college_name, status, starts_on, ends_on from ev
        where status not in ('live', 'completed', 'archived') and ends_on >= current_date
        order by starts_on asc limit 6
      ) s
    ),
    'live_events', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select id, name, college_name, status, starts_on, ends_on from ev where status = 'live' order by starts_on limit 6
      ) s
    ),
    'pending_approvals', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select x.id, x.request_number, x.title, x.requested_amount, x.status, x.event_id, ev.name as event, d.name as department, x.created_at
        from public.expense_requests x join ev on ev.id = x.event_id join public.departments d on d.id = x.department_id
        where x.status in ('submitted', 'under_review', 'forwarded')
        order by x.created_at asc limit 8
      ) s
    ),
    'recent_users', case when v_super then (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select id, full_name, email, status, created_at from public.profiles order by created_at desc limit 6
      ) s) else '[]'::jsonb end,
    'latest_registrations', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select r.id, r.registration_number, r.participant_name, r.category, r.payable_amount, r.payment_status,
               r.status, r.created_at, r.event_id, ev.name as event
        from public.registrations r join ev on ev.id = r.event_id
        order by r.created_at desc limit 8
      ) s
    ),
    'latest_transactions', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select t.id, t.txn_number, t.kind, t.direction, t.category, t.amount, t.status, t.occurred_on, t.event_id, ev.name as event
        from public.financial_transactions t join ev on ev.id = t.event_id
        order by t.created_at desc limit 8
      ) s
    ),
    'alerts', (
      select coalesce(jsonb_agg(a), '[]'::jsonb) from (
        select jsonb_build_object('level', case when x.used_pct >= 100 then 'critical' when x.used_pct >= 90 then 'high' else 'warning' end,
                                  'title', x.department || ' budget at ' || round(x.used_pct) || '%',
                                  'detail', x.event, 'event_id', x.event_id) as a
        from (
          select d.name as department, ev.name as event, ev.id as event_id,
                 100.0 * coalesce((select sum(coalesce(r.approved_amount, 0)) from public.expense_requests r
                                   where r.department_id = d.id and r.status in ('approved', 'partially_paid', 'paid')), 0)
                   / nullif(ba.allocated_amount, 0) as used_pct
          from public.budget_allocations ba
          join public.departments d on d.id = ba.department_id
          join ev on ev.id = ba.event_id
          where ba.allocated_amount > 0
        ) x where x.used_pct >= 75
        union all
        select jsonb_build_object('level', 'warning', 'title', 'Registrations close soon', 'detail', ev.name, 'event_id', ev.id)
        from ev where ev.registration_closes_at between now() and now() + interval '3 days'
        union all
        select jsonb_build_object('level', 'high', 'title', count(*) || ' overdue tasks', 'detail', ev.name, 'event_id', ev.id)
        from public.tasks t join ev on ev.id = t.event_id
        where t.status <> 'completed' and t.due_at < now()
        group by ev.id, ev.name
        limit 12
      ) alerts
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select a.id, a.activity_type, a.summary, a.created_at, a.event_id, ev.name as event, p.full_name as actor
        from public.activity_log a
        join ev on ev.id = a.event_id
        left join public.profiles p on p.id = a.actor_id
        where v_super or app.has_event_permission(a.event_id, a.required_permission)
        order by a.created_at desc limit 12
      ) s
    )
  ) into v_result;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Event dashboard. Finance and registration figures are included only for
-- users holding the corresponding view permission.
-- ---------------------------------------------------------------------------
create or replace function public.event_dashboard(p_event uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.events;
  v_can_fin boolean;
  v_can_reg boolean;
  v_from date;
  v_to date;
  v_result jsonb;
begin
  if not app.has_event_permission(p_event, 'event.view') then
    raise exception 'Not authorized to view this event' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event;
  v_can_fin := app.has_event_permission(p_event, 'finance.view');
  v_can_reg := app.has_event_permission(p_event, 'registrations.view') or v_can_fin;
  v_from := coalesce(p_from, least(current_date, v_event.starts_on) - 29);
  v_to := coalesce(p_to, greatest(current_date, v_from));

  with days as (select generate_series(v_from, v_to, interval '1 day')::date as d),
  tasks as (select * from public.tasks t where t.event_id = p_event and t.parent_task_id is null)
  select jsonb_build_object(
    'access', jsonb_build_object('finance', v_can_fin, 'registrations', v_can_reg),
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'tasks', jsonb_build_object(
      'total', (select count(*) from tasks),
      'pending', (select count(*) from tasks where status <> 'completed'),
      'completed', (select count(*) from tasks where status = 'completed'),
      'overdue', (select count(*) from tasks where status <> 'completed' and due_at < now()),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from tasks group by status) s)
    ),
    'departments', (select count(*) from public.departments where event_id = p_event and status = 'active'),
    'members', (select count(distinct u) from (
                  select user_id u from public.event_members where event_id = p_event and ended_at is null
                  union select user_id from public.department_members where event_id = p_event and ended_at is null) s),
    'registrations', case when v_can_reg then jsonb_build_object(
      'total', (select count(*) from public.registrations where event_id = p_event),
      'confirmed', (select count(*) from public.registrations where event_id = p_event and status = 'confirmed'),
      'pending', (select count(*) from public.registrations where event_id = p_event and status = 'pending'),
      'cancelled', (select count(*) from public.registrations where event_id = p_event and status = 'cancelled'),
      'failed_payments', (select count(*) from public.registrations where event_id = p_event and payment_status = 'failed'),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'count', n) order by n desc), '[]'::jsonb)
                      from (select category, count(*) n from public.registrations where event_id = p_event and status <> 'cancelled' group by category) s),
      'by_payment_status', (select coalesce(jsonb_agg(jsonb_build_object('status', payment_status, 'count', n)), '[]'::jsonb)
                            from (select payment_status, count(*) n from public.registrations where event_id = p_event group by payment_status) s),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', days.d, 'registrations', coalesce(x.n, 0)) order by days.d), '[]'::jsonb)
                from days left join (select created_at::date d, count(*) n from public.registrations where event_id = p_event group by 1) x on x.d = days.d)
    ) end,
    'finance', case when v_can_fin then app.financial_summary(array[p_event]) end,
    'finance_charts', case when v_can_fin then jsonb_build_object(
      'registration_revenue', (
        select coalesce(jsonb_agg(jsonb_build_object('date', days.d, 'amount', coalesce(x.amt, 0)) order by days.d), '[]'::jsonb)
        from days left join (
          select occurred_on d, sum(amount) amt from public.financial_transactions
          where event_id = p_event and status = 'verified' and kind = 'income' and category in ('online_registration', 'offline_registration')
          group by 1) x on x.d = days.d),
      'income_vs_expenditure', (
        select coalesce(jsonb_agg(jsonb_build_object('date', days.d, 'income', coalesce(x.inc, 0), 'expenditure', coalesce(x.exp, 0)) order by days.d), '[]'::jsonb)
        from days left join (
          select occurred_on d,
                 sum(amount) filter (where kind = 'income' or (kind = 'adjustment' and direction = 'in')) inc,
                 sum(amount) filter (where kind in ('expense', 'refund') or (kind = 'adjustment' and direction = 'out')) exp
          from public.financial_transactions where event_id = p_event and status = 'verified' group by 1) x on x.d = days.d),
      'department_budgets', (
        select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.allocated desc), '[]'::jsonb) from (
          select d.id, d.name as department,
                 coalesce(ba.allocated_amount, 0) as allocated,
                 coalesce(sum(coalesce(r.approved_amount, 0)) filter (where r.status in ('approved', 'partially_paid', 'paid')), 0) as approved,
                 coalesce(sum(r.paid_amount), 0) as paid,
                 coalesce(sum(r.requested_amount) filter (where r.status in ('submitted', 'under_review', 'forwarded', 'changes_requested')), 0) as pending
          from public.departments d
          left join public.budget_allocations ba on ba.department_id = d.id
          left join public.expense_requests r on r.department_id = d.id
          where d.event_id = p_event
          group by d.id, d.name, ba.allocated_amount
          having coalesce(ba.allocated_amount, 0) > 0 or count(r.id) > 0
        ) s),
      'sponsorship_stages', (
        select coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'count', n, 'agreed', agreed, 'received', received)), '[]'::jsonb)
        from (select stage, count(*) n, sum(agreed_amount) agreed, sum(received_amount) received
              from public.sponsorship_deals where event_id = p_event group by stage) s)
    ) end,
    'activity', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) from (
        select a.id, a.activity_type, a.summary, a.created_at, a.department_id, p.full_name as actor
        from public.activity_log a left join public.profiles p on p.id = a.actor_id
        where a.event_id = p_event and app.has_event_permission(p_event, a.required_permission)
        order by a.created_at desc limit 20
      ) s
    )
  ) into v_result;

  return v_result;
end $$;

revoke execute on function public.my_access() from anon;
revoke execute on function public.my_event_permissions(uuid) from anon;
revoke execute on function public.global_dashboard(uuid, uuid, public.event_status, date, date) from anon;
revoke execute on function public.event_dashboard(uuid, date, date) from anon;
revoke execute on function public.event_financial_summary(uuid, date, date) from anon;

-- ---------------------------------------------------------------------------
-- Storage
--   documents (private): {event_id}/{department_id|event}/{uuid}-{name}
--   avatars   (public):  {user_id}/{file}
--   branding  (public):  colleges/{college_id}/{file} | events/{event_id}/{file}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documents', 'documents', false, 52428800, array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv', 'text/plain', 'video/mp4', 'video/quicktime', 'application/zip'
  ]),
  ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('branding', 'branding', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy documents_objects_select on storage.objects for select to authenticated using (
  bucket_id = 'documents'
  and exists (select 1 from public.documents d where d.bucket = 'documents' and d.storage_path = storage.objects.name)
);
create policy documents_objects_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'documents'
  and (
    app.has_event_permission(app.try_uuid((storage.foldername(name))[1]), 'documents.upload')
    or app.has_department_permission(app.try_uuid((storage.foldername(name))[2]), 'documents.upload')
  )
);

create policy avatars_objects_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy avatars_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_objects_delete on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function app.can_manage_branding_path(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case (storage.foldername(p_name))[1]
    when 'colleges' then app.has_college_permission(app.try_uuid((storage.foldername(p_name))[2]), 'college.manage')
    when 'events' then app.has_event_permission(app.try_uuid((storage.foldername(p_name))[2]), 'event.manage')
    else false
  end
$$;
grant execute on function app.can_manage_branding_path(text) to authenticated;
grant execute on function app.try_uuid(text) to authenticated;

create policy branding_objects_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'branding' and app.can_manage_branding_path(name)
);
create policy branding_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'branding' and app.can_manage_branding_path(name))
  with check (bucket_id = 'branding' and app.can_manage_branding_path(name));
create policy branding_objects_delete on storage.objects for delete to authenticated using (
  bucket_id = 'branding' and app.can_manage_branding_path(name)
);

-- ---------------------------------------------------------------------------
-- Realtime: tables whose changes drive live dashboards (RLS still applies).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.notifications, public.activity_log, public.registrations, public.financial_transactions,
  public.expense_requests, public.tasks;
