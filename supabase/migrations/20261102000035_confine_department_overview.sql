-- ============================================================================
-- EVENT APP — Migration 35: department overview only lists departments the
-- person can open (unless they see all departments or oversee finance).
-- ============================================================================

create or replace function public.event_departments_overview(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fin boolean;
  v_all boolean;
begin
  if not app.has_event_permission(p_event, 'event.view') then
    raise exception 'Not authorized to view this event' using errcode = '42501';
  end if;
  v_fin := app.has_event_permission(p_event, 'finance.view') or app.has_event_permission(p_event, 'budgets.manage');
  v_all := app.has_event_permission(p_event, 'department.view');

  return coalesce((
    select jsonb_agg(row_to_json(s)::jsonb order by s.sort_order, s.name)
    from (
      select d.id, d.name, d.kind, d.icon, d.status, d.description, d.progress_pct, d.sort_order,
        (select jsonb_build_object('user_id', p.id, 'name', p.full_name, 'email', p.email, 'avatar_path', p.avatar_path)
           from public.department_members m join public.profiles p on p.id = m.user_id
          where m.department_id = d.id and m.position = 'head' and m.ended_at is null limit 1) as head,
        (select count(*) from public.department_members m where m.department_id = d.id and m.ended_at is null) as members,
        (select count(*) from public.tasks t where t.department_id = d.id and t.parent_task_id is null) as tasks_total,
        (select count(*) from public.tasks t where t.department_id = d.id and t.parent_task_id is null and t.status = 'completed') as tasks_completed,
        (select count(*) from public.tasks t where t.department_id = d.id and t.parent_task_id is null and t.status <> 'completed' and t.due_at < now()) as tasks_overdue,
        case when v_fin or app.has_department_permission(d.id, 'budgets.view') then jsonb_build_object(
          'allocated', coalesce((select a.allocated_amount from public.budget_allocations a where a.department_id = d.id), 0),
          'approved', coalesce((select sum(coalesce(r.approved_amount, 0)) from public.expense_requests r
                                 where r.department_id = d.id and r.status in ('approved', 'partially_paid', 'paid')), 0),
          'paid', coalesce((select sum(r.paid_amount) from public.expense_requests r where r.department_id = d.id), 0)
        ) end as budget,
        app.has_department_permission(d.id, 'department.view') as can_open
      from public.departments d
      where d.event_id = p_event
        -- People confined to their department only see the departments they can open;
        -- finance reviewers see every department for budget oversight.
        and (v_all or v_fin or app.has_department_permission(d.id, 'department.view'))
    ) s
  ), '[]'::jsonb);
end $$;
