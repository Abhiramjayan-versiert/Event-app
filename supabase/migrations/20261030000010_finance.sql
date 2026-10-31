-- ============================================================================
-- EVENT APP — Migration 10: Finance workflows (Phase 4)
--
-- Expense approval workflow, payments, reversals, budget allocation and
-- budget revisions. Every function checks permissions explicitly, locks the
-- rows it changes and writes an append-only history entry.
-- ============================================================================

-- Allow the ledger to be written only through these functions for expenses
-- and reversals (direct inserts remain limited to income/adjustments by RLS).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.approval_limit(p_event uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((s.approval_limits ->> 'requires_final_approval_above')::numeric, 10000)
  from public.event_settings s where s.event_id = p_event
$$;

create or replace function app.department_budget_usage(p_department uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when coalesce(a.allocated_amount, 0) = 0 then null
              else 100.0 * coalesce((select sum(coalesce(r.approved_amount, 0)) from public.expense_requests r
                                      where r.department_id = p_department and r.status in ('approved', 'partially_paid', 'paid')), 0)
                   / a.allocated_amount end
  from public.departments d left join public.budget_allocations a on a.department_id = d.id
  where d.id = p_department
$$;

-- Notifies department leadership + finance reviewers when usage crosses 75/90/100%.
create or replace function app.check_budget_thresholds(p_department uuid, p_before numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_after numeric := app.department_budget_usage(p_department);
  v_dept public.departments;
  v_level int;
begin
  if v_after is null then return; end if;
  v_level := case when v_after >= 100 and coalesce(p_before, 0) < 100 then 100
                  when v_after >= 90 and coalesce(p_before, 0) < 90 then 90
                  when v_after >= 75 and coalesce(p_before, 0) < 75 then 75 end;
  if v_level is null then return; end if;
  select * into v_dept from public.departments where id = p_department;
  insert into public.notifications (user_id, event_id, type, title, body, link)
  select distinct m.user_id, v_dept.event_id, 'budget.threshold',
         v_dept.name || case when v_level = 100 then ' budget exceeded' else ' budget at ' || v_level || '%' end,
         round(v_after) || '% of the allocated budget is committed by approved expenses.',
         '/events/' || v_dept.event_id || '/departments/' || v_dept.id
  from public.department_members m
  where m.department_id = p_department and m.ended_at is null and m.position in ('head', 'assistant_head');
  perform app.notify_permission_holders(v_dept.event_id, 'finance.review', 'budget.threshold',
    v_dept.name || case when v_level = 100 then ' budget exceeded' else ' budget at ' || v_level || '%' end,
    round(v_after) || '% of the allocated budget is committed.', '/events/' || v_dept.event_id || '/finance?tab=budget');
  perform app.log_activity(v_dept.event_id, v_dept.id, 'budget.threshold',
    v_dept.name || ' budget reached ' || round(v_after) || '%', 'departments', v_dept.id, 'finance.view');
end $$;

-- ---------------------------------------------------------------------------
-- Expense approval workflow
-- ---------------------------------------------------------------------------
create or replace function public.expense_transition(
  p_expense uuid,
  p_action public.approval_action,
  p_amount numeric default null,
  p_comment text default null
) returns public.expense_status
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.active_uid();
  r public.expense_requests;
  v_from public.expense_status;
  v_to public.expense_status;
  v_amount numeric := null;
  v_is_submitter boolean;
  v_can_review boolean;
  v_can_approve boolean;
  v_usage_before numeric;
  v_link text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select * into r from public.expense_requests where id = p_expense for update;
  if r.id is null then raise exception 'Expense request not found' using errcode = 'P0002'; end if;

  v_from := r.status;
  v_is_submitter := r.submitted_by = v_uid
    or app.has_department_permission(r.department_id, 'expenses.submit_department')
    or app.has_event_permission(r.event_id, 'expenses.submit');
  v_can_review := app.has_event_permission(r.event_id, 'finance.review') or app.has_event_permission(r.event_id, 'finance.approve');
  v_can_approve := app.has_event_permission(r.event_id, 'finance.approve');
  v_link := '/events/' || r.event_id || '/finance/expenses/' || r.id;

  case p_action
    when 'submit', 'resubmit' then
      if not v_is_submitter then raise exception 'You cannot submit this request' using errcode = '42501'; end if;
      if v_from not in ('draft', 'changes_requested') then raise exception 'Only drafts or returned requests can be submitted' using errcode = '22023'; end if;
      v_to := 'submitted';
      update public.expense_requests set status = v_to, submitted_at = now() where id = r.id;
      perform app.notify_permission_holders(r.event_id, 'finance.review', 'expense.submitted',
        'Expense submitted: ' || r.title, r.request_number || ' · ' || r.requested_amount, v_link);
    when 'start_review' then
      if not v_can_review then raise exception 'You cannot review expenses' using errcode = '42501'; end if;
      if v_from not in ('submitted', 'forwarded') then raise exception 'This request is not awaiting review' using errcode = '22023'; end if;
      v_to := 'under_review';
      update public.expense_requests set status = v_to where id = r.id;
    when 'approve' then
      if not v_can_review then raise exception 'You cannot approve expenses' using errcode = '42501'; end if;
      if v_from not in ('submitted', 'under_review', 'forwarded') then raise exception 'This request cannot be approved in its current state' using errcode = '22023'; end if;
      v_amount := coalesce(p_amount, r.requested_amount);
      if v_amount <= 0 or v_amount > r.requested_amount then
        raise exception 'Approved amount must be between 0 and the requested amount' using errcode = '22023';
      end if;
      if v_amount > app.approval_limit(r.event_id) and not v_can_approve then
        raise exception 'Amounts above % need final approval. Forward the request instead.', app.approval_limit(r.event_id) using errcode = '42501';
      end if;
      v_usage_before := app.department_budget_usage(r.department_id);
      v_to := 'approved';
      update public.expense_requests set status = v_to, approved_amount = v_amount, decided_by = v_uid, decided_at = now() where id = r.id;
      perform app.notify(r.submitted_by, r.event_id, 'expense.approved', 'Expense approved: ' || r.title,
        'Approved amount: ' || v_amount, v_link);
      perform app.check_budget_thresholds(r.department_id, v_usage_before);
    when 'forward' then
      if not v_can_review then raise exception 'You cannot forward expenses' using errcode = '42501'; end if;
      if v_from not in ('submitted', 'under_review') then raise exception 'This request cannot be forwarded' using errcode = '22023'; end if;
      v_to := 'forwarded';
      update public.expense_requests set status = v_to where id = r.id;
      perform app.notify_permission_holders(r.event_id, 'finance.approve', 'expense.forwarded',
        'Final approval needed: ' || r.title, r.request_number || ' · ' || r.requested_amount, v_link);
    when 'request_changes' then
      if not v_can_review then raise exception 'You cannot return expenses' using errcode = '42501'; end if;
      if v_from not in ('submitted', 'under_review', 'forwarded') then raise exception 'This request cannot be returned' using errcode = '22023'; end if;
      if coalesce(trim(p_comment), '') = '' then raise exception 'Explain what needs to change' using errcode = '22023'; end if;
      v_to := 'changes_requested';
      update public.expense_requests set status = v_to where id = r.id;
      perform app.notify(r.submitted_by, r.event_id, 'expense.changes_requested', 'Changes requested: ' || r.title, p_comment, v_link);
    when 'reject' then
      if not v_can_review then raise exception 'You cannot reject expenses' using errcode = '42501'; end if;
      if v_from not in ('submitted', 'under_review', 'forwarded') then raise exception 'This request cannot be rejected' using errcode = '22023'; end if;
      if coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason for rejecting' using errcode = '22023'; end if;
      v_to := 'rejected';
      update public.expense_requests set status = v_to, decided_by = v_uid, decided_at = now() where id = r.id;
      perform app.notify(r.submitted_by, r.event_id, 'expense.rejected', 'Expense rejected: ' || r.title, p_comment, v_link);
    when 'cancel' then
      if v_from in ('draft', 'submitted', 'changes_requested') and v_is_submitter then
        null;
      elsif v_from in ('draft', 'submitted', 'under_review', 'changes_requested', 'forwarded', 'approved')
            and app.has_event_permission(r.event_id, 'finance.manage') and r.paid_amount = 0 then
        null;
      else
        raise exception 'This request can no longer be cancelled' using errcode = '42501';
      end if;
      v_to := 'cancelled';
      update public.expense_requests set status = v_to where id = r.id;
    else
      raise exception 'Unsupported action %', p_action using errcode = '22023';
  end case;

  insert into public.expense_approvals (expense_request_id, event_id, college_id, actor_id, action, from_status, to_status, amount, comment)
  values (r.id, r.event_id, r.college_id, v_uid, p_action, v_from, v_to, v_amount, nullif(trim(p_comment), ''));

  perform app.log_activity(r.event_id, r.department_id, 'expense.' || p_action,
    'Expense ' || r.request_number || ' "' || r.title || '": ' || replace(v_to::text, '_', ' '),
    'expense_requests', r.id, 'finance.view');
  return v_to;
end $$;

-- Records an actual payment against an approved expense and books it in the ledger.
create or replace function public.record_expense_payment(
  p_expense uuid,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_reference text default null,
  p_notes text default null,
  p_document uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.active_uid();
  r public.expense_requests;
  v_txn uuid;
  v_to public.expense_status;
begin
  select * into r from public.expense_requests where id = p_expense for update;
  if r.id is null then raise exception 'Expense request not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(r.event_id, 'finance.manage') then
    raise exception 'You cannot record payments' using errcode = '42501';
  end if;
  if r.status not in ('approved', 'partially_paid') then
    raise exception 'Only approved expenses can be paid' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > r.approved_amount - r.paid_amount then
    raise exception 'Payment must be between 0 and the unpaid approved amount (%)', r.approved_amount - r.paid_amount using errcode = '22023';
  end if;
  if coalesce(trim(p_method), '') = '' then raise exception 'Payment method is required' using errcode = '22023'; end if;

  insert into public.financial_transactions (event_id, college_id, department_id, kind, direction, category, amount, occurred_on,
                                             description, payment_method, payment_reference, status, expense_request_id, document_id, notes)
  values (r.event_id, r.college_id, r.department_id, 'expense', 'out', r.category, p_amount, coalesce(p_paid_on, current_date),
          r.request_number || ' · ' || r.title, p_method, nullif(trim(p_reference), ''), 'verified', r.id, p_document, nullif(trim(p_notes), ''))
  returning id into v_txn;

  v_to := case when r.paid_amount + p_amount >= r.approved_amount then 'paid'::public.expense_status else 'partially_paid'::public.expense_status end;
  update public.expense_requests set paid_amount = paid_amount + p_amount, status = v_to where id = r.id;

  insert into public.expense_approvals (expense_request_id, event_id, college_id, actor_id, action, from_status, to_status, amount, comment)
  values (r.id, r.event_id, r.college_id, v_uid, 'record_payment', r.status, v_to, p_amount, nullif(trim(p_reference), ''));

  perform app.notify(r.submitted_by, r.event_id, 'expense.paid', 'Payment recorded: ' || r.title,
    'Paid ' || p_amount || ' via ' || p_method, '/events/' || r.event_id || '/finance/expenses/' || r.id);
  perform app.log_activity(r.event_id, r.department_id, 'expense.paid',
    'Payment of ' || p_amount || ' recorded for ' || r.request_number, 'financial_transactions', v_txn, 'finance.view');
  return v_txn;
end $$;

-- Reverses a verified ledger entry (with a reason). Reversing an expense
-- payment also reduces the expense request's paid amount.
create or replace function public.reverse_transaction(p_transaction uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.financial_transactions;
  v_rev uuid;
  v_prev public.expense_status;
begin
  select * into t from public.financial_transactions where id = p_transaction for update;
  if t.id is null then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(t.event_id, 'finance.manage') then
    raise exception 'You cannot reverse transactions' using errcode = '42501';
  end if;
  if t.kind in ('reversal') then raise exception 'A reversal cannot be reversed' using errcode = '22023'; end if;
  if t.status <> 'verified' then raise exception 'Only verified transactions can be reversed' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;

  insert into public.financial_transactions (event_id, college_id, department_id, kind, direction, category, amount, occurred_on,
                                             description, status, reverses_transaction_id, notes)
  values (t.event_id, t.college_id, t.department_id, 'reversal', 'out', t.category, t.amount, current_date,
          'Reversal of ' || t.txn_number, 'verified', t.id, trim(p_reason))
  returning id into v_rev;
  update public.financial_transactions set status = 'reversed' where id = t.id;

  if t.kind = 'expense' and t.expense_request_id is not null then
    select status into v_prev from public.expense_requests where id = t.expense_request_id for update;
    update public.expense_requests
       set paid_amount = greatest(paid_amount - t.amount, 0),
           status = case when paid_amount - t.amount <= 0 then 'approved'::public.expense_status else 'partially_paid'::public.expense_status end
     where id = t.expense_request_id;
    insert into public.expense_approvals (expense_request_id, event_id, college_id, actor_id, action, from_status, to_status, amount, comment)
    select r.id, r.event_id, r.college_id, app.active_uid(), 'record_payment', v_prev, r.status, -t.amount, 'Payment reversed: ' || trim(p_reason)
    from public.expense_requests r where r.id = t.expense_request_id;
  end if;

  perform app.log_activity(t.event_id, t.department_id, 'ledger.reversal',
    t.txn_number || ' reversed: ' || trim(p_reason), 'financial_transactions', v_rev, 'finance.view');
  return v_rev;
end $$;

-- ---------------------------------------------------------------------------
-- Budget
-- ---------------------------------------------------------------------------
create or replace function public.set_department_allocation(p_department uuid, p_amount numeric, p_notes text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.departments;
  v_budget uuid;
  v_before numeric;
  v_old numeric;
begin
  select * into d from public.departments where id = p_department;
  if d.id is null then raise exception 'Department not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(d.event_id, 'budgets.manage') then
    raise exception 'You cannot manage budgets' using errcode = '42501';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'Amount must be zero or more' using errcode = '22023'; end if;
  select id into v_budget from public.budgets where event_id = d.event_id;
  v_before := app.department_budget_usage(p_department);
  select allocated_amount into v_old from public.budget_allocations where department_id = p_department;

  insert into public.budget_allocations (event_id, college_id, budget_id, department_id, allocated_amount, notes, set_by)
  values (d.event_id, d.college_id, v_budget, p_department, p_amount, nullif(trim(p_notes), ''), app.active_uid())
  on conflict (department_id) do update set allocated_amount = excluded.allocated_amount, notes = excluded.notes, set_by = excluded.set_by;

  if v_old is distinct from p_amount then
    perform app.log_activity(d.event_id, d.id, 'budget.allocation',
      d.name || ' budget set to ' || p_amount || coalesce(' (was ' || v_old || ')', ''), 'departments', d.id, 'finance.view');
  end if;
  perform app.check_budget_thresholds(p_department, case when v_old is null or v_old = 0 then 0 else v_before end);
end $$;

create or replace function public.decide_budget_revision(p_revision uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  rv public.budget_revisions;
begin
  select * into rv from public.budget_revisions where id = p_revision for update;
  if rv.id is null then raise exception 'Revision not found' using errcode = 'P0002'; end if;
  if not app.has_event_permission(rv.event_id, 'budgets.manage') then
    raise exception 'You cannot decide budget revisions' using errcode = '42501';
  end if;
  if rv.status <> 'pending' then raise exception 'This revision was already decided' using errcode = '22023'; end if;

  update public.budget_revisions
     set status = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
         decided_by = app.active_uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = rv.id;

  if p_approve then
    if rv.department_id is null then
      update public.budgets set total_amount = rv.requested_amount, set_by = app.active_uid() where event_id = rv.event_id;
    else
      perform public.set_department_allocation(rv.department_id, rv.requested_amount, 'Revision approved');
    end if;
  end if;
  perform app.notify(rv.requested_by, rv.event_id, 'budget.revision',
    'Budget revision ' || case when p_approve then 'approved' else 'rejected' end,
    coalesce(p_note, ''), '/events/' || rv.event_id || coalesce('/departments/' || rv.department_id, '/finance?tab=budget'));
end $$;

-- Notify budget managers about new revision requests.
create or replace function app.budget_revision_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.notify_permission_holders(new.event_id, 'budgets.manage', 'budget.revision_requested',
    'Budget revision requested', coalesce((select name from public.departments where id = new.department_id), 'Event budget')
      || ': ' || new.previous_amount || ' → ' || new.requested_amount, '/events/' || new.event_id || '/finance?tab=budget');
  return new;
end $$;
create trigger budget_revisions_notify after insert on public.budget_revisions
  for each row execute function app.budget_revision_after_insert();

-- Activity entries for income recorded or verified directly.
create or replace function app.ledger_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('income', 'adjustment') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform app.log_activity(new.event_id, new.department_id, 'ledger.' || new.status,
      initcap(replace(new.category, '_', ' ')) || ' ' || new.kind || ' of ' || new.amount || ' ' ||
      case new.status when 'verified' then 'verified' when 'pending' then 'recorded (pending)' else new.status::text end,
      'financial_transactions', new.id, 'finance.view');
  end if;
  return null;
end $$;
create trigger financial_transactions_activity after insert or update on public.financial_transactions
  for each row execute function app.ledger_after_write();

do $$
declare f text;
begin
  foreach f in array array[
    'public.expense_transition(uuid, public.approval_action, numeric, text)',
    'public.record_expense_payment(uuid, numeric, date, text, text, text, uuid)',
    'public.reverse_transaction(uuid, text)',
    'public.set_department_allocation(uuid, numeric, text)',
    'public.decide_budget_revision(uuid, boolean, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
