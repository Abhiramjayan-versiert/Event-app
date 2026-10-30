export type FinanceSummary = {
  total_budget: number;
  allocated_budget: number;
  registration_income: number;
  sponsorship_income: number;
  other_income: number;
  total_income_received: number;
  refunds_paid: number;
  expenditure_paid: number;
  approved_expenses_total: number;
  approved_unpaid: number;
  pending_expense_count: number;
  pending_expense_amount: number;
  sponsorship_committed: number;
  outstanding_sponsorship: number;
  net_cash_position: number;
};

type Row = Record<string, unknown>;

export type GlobalDashboard = {
  scope: { is_super_admin: boolean; college_count: number; event_count: number; from: string; to: string };
  cards: {
    total_colleges: number; active_colleges: number; total_events: number; upcoming_events: number; live_events: number;
    completed_events: number; total_participants: number; total_users: number;
  };
  finance: FinanceSummary;
  registration_trend: { date: string; registrations: number; confirmed: number }[];
  revenue_by_college: { college: string; code: string; income: number; expenditure: number }[];
  revenue_by_event: { id: string; event: string; college: string; income: number; registration_income: number; sponsorship_income: number; expenditure: number }[];
  income_vs_expenditure: { date: string; income: number; expenditure: number }[];
  sponsorship_by_event: { event: string; committed: number; received: number; deals: number }[];
  activity_trend: { date: string; activities: number }[];
  department_performance: { department: string; total: number; completed: number; overdue: number }[];
  events_by_college: { college: string; total: number; live: number; upcoming: number; completed: number }[];
  recent_colleges: { id: string; name: string; code: string; city: string | null; status: string; created_at: string }[];
  recent_events: { id: string; name: string; college_name: string; status: string; starts_on: string; ends_on: string; created_at: string }[];
  upcoming_events: { id: string; name: string; college_name: string; status: string; starts_on: string; ends_on: string }[];
  live_events: { id: string; name: string; college_name: string; status: string; starts_on: string; ends_on: string }[];
  pending_approvals: { id: string; request_number: string; title: string; requested_amount: number; status: string; event_id: string; event: string; department: string; created_at: string }[];
  recent_users: { id: string; full_name: string; email: string; status: string; created_at: string }[];
  latest_registrations: { id: string; registration_number: string; participant_name: string; category: string; payable_amount: number; payment_status: string; status: string; created_at: string; event_id: string; event: string }[];
  latest_transactions: { id: string; txn_number: string; kind: string; direction: string; category: string; amount: number; status: string; occurred_on: string; event_id: string; event: string }[];
  alerts: { level: "warning" | "high" | "critical"; title: string; detail: string; event_id: string }[];
  recent_activity: { id: string; activity_type: string; summary: string; created_at: string; event_id: string; event: string; actor: string | null }[];
  _?: Row;
};

export type EventDashboard = {
  access: { finance: boolean; registrations: boolean };
  range: { from: string; to: string };
  tasks: { total: number; pending: number; completed: number; overdue: number; by_status: Record<string, number> };
  departments: number;
  members: number;
  registrations: null | {
    total: number; confirmed: number; pending: number; cancelled: number; failed_payments: number;
    by_category: { category: string; count: number }[];
    by_payment_status: { status: string; count: number }[];
    daily: { date: string; registrations: number }[];
  };
  finance: FinanceSummary | null;
  finance_charts: null | {
    registration_revenue: { date: string; amount: number }[];
    income_vs_expenditure: { date: string; income: number; expenditure: number }[];
    department_budgets: { id: string; department: string; allocated: number; approved: number; paid: number; pending: number }[];
    sponsorship_stages: { stage: string; count: number; agreed: number; received: number }[];
  };
  activity: { id: string; activity_type: string; summary: string; created_at: string; department_id: string | null; actor: string | null }[];
};
