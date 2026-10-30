-- ============================================================================
-- EVENT APP — Migration 2: Operational schema
-- Registrations, payments, finance, sponsorship, tasks, communication,
-- operations, documents, audit and API integration tables.
-- ============================================================================

create type public.registration_type as enum ('individual', 'team');
create type public.registration_source as enum ('website', 'offline', 'manual', 'api');
create type public.registration_status as enum ('pending', 'confirmed', 'cancelled', 'waitlisted');
create type public.payment_status as enum (
  'not_required', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled'
);
create type public.txn_kind as enum ('income', 'expense', 'refund', 'reversal', 'adjustment');
create type public.txn_direction as enum ('in', 'out');
create type public.txn_status as enum ('pending', 'verified', 'rejected', 'reversed');
create type public.expense_status as enum (
  'draft', 'submitted', 'under_review', 'changes_requested', 'forwarded', 'approved', 'rejected',
  'partially_paid', 'paid', 'cancelled'
);
create type public.approval_action as enum (
  'submit', 'start_review', 'approve', 'reject', 'request_changes', 'forward', 'cancel', 'record_payment', 'resubmit'
);
create type public.request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.sponsor_stage as enum (
  'lead_identified', 'contacted', 'meeting_scheduled', 'proposal_sent', 'negotiation', 'confirmed',
  'partially_paid', 'fully_paid', 'rejected', 'lost'
);
create type public.work_status as enum ('pending', 'in_progress', 'completed', 'cancelled');
create type public.task_status as enum ('not_started', 'in_progress', 'under_review', 'completed', 'on_hold');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.announcement_scope as enum ('global', 'college', 'event', 'department');
create type public.document_visibility as enum ('event', 'department', 'finance', 'restricted');
create type public.schedule_status as enum ('scheduled', 'in_progress', 'completed', 'delayed', 'cancelled');
create type public.campaign_status as enum ('planned', 'active', 'paused', 'completed', 'cancelled');
create type public.media_asset_status as enum ('draft', 'pending_approval', 'approved', 'published', 'rejected');
create type public.api_environment as enum ('sandbox', 'production');

-- ---------------------------------------------------------------------------
-- Competitions / registration categories offered by an event
-- ---------------------------------------------------------------------------
create table public.event_competitions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete set null,
  name text not null,
  code text not null,
  category text not null default 'general',
  description text,
  fee numeric(12, 2) not null default 0,
  registration_type public.registration_type not null default 'individual',
  team_min int not null default 1,
  team_max int not null default 1,
  capacity int,
  starts_at timestamptz,
  ends_at timestamptz,
  venue text,
  rules_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_competitions_fee check (fee >= 0),
  constraint event_competitions_team check (team_min >= 1 and team_max >= team_min),
  constraint event_competitions_capacity check (capacity is null or capacity > 0),
  constraint event_competitions_code check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$')
);
create unique index event_competitions_code_key on public.event_competitions (event_id, code);

-- ---------------------------------------------------------------------------
-- Registrations
-- ---------------------------------------------------------------------------
create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  registration_number text not null,
  external_reference text,
  participant_name text not null,
  email text not null,
  phone text,
  participant_college text,
  course text,
  academic_year text,
  category text not null default 'general',
  registration_type public.registration_type not null default 'individual',
  team_name text,
  team_members jsonb not null default '[]'::jsonb,
  source public.registration_source not null default 'website',
  status public.registration_status not null default 'pending',
  amount numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  payable_amount numeric(12, 2) generated always as (greatest(amount - discount, 0)) stored,
  amount_paid numeric(12, 2) not null default 0,
  amount_refunded numeric(12, 2) not null default 0,
  currency char(3) not null default 'INR',
  payment_status public.payment_status not null default 'pending',
  payment_gateway text,
  payment_reference text,
  custom_fields jsonb not null default '{}'::jsonb,
  dedupe_key text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  api_credential_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registrations_amounts check (amount >= 0 and discount >= 0 and amount_paid >= 0 and amount_refunded >= 0),
  constraint registrations_refund_le_paid check (amount_refunded <= amount_paid),
  constraint registrations_email check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint registrations_team check (registration_type = 'individual' or team_name is not null),
  constraint registrations_team_members_array check (jsonb_typeof(team_members) = 'array')
);
create unique index registrations_number_key on public.registrations (event_id, registration_number);
create unique index registrations_external_key on public.registrations (event_id, external_reference)
  where external_reference is not null;
-- Duplicate prevention: dedupe_key is computed from the event's configured rule.
create unique index registrations_dedupe_key on public.registrations (event_id, dedupe_key)
  where dedupe_key is not null and status <> 'cancelled';
create index registrations_event_created_idx on public.registrations (event_id, created_at desc);
create index registrations_event_status_idx on public.registrations (event_id, payment_status, status);
create index registrations_email_idx on public.registrations (event_id, lower(email));

create table public.registration_items (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  competition_id uuid references public.event_competitions (id) on delete restrict,
  item_name text not null,
  category text,
  quantity int not null default 1,
  unit_price numeric(12, 2) not null default 0,
  amount numeric(12, 2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_items_qty check (quantity > 0 and unit_price >= 0)
);
create index registration_items_registration_idx on public.registration_items (registration_id);
create index registration_items_competition_idx on public.registration_items (competition_id);

-- ---------------------------------------------------------------------------
-- Payments (gateway) & webhook journal
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  registration_id uuid references public.registrations (id) on delete restrict,
  provider text not null,
  provider_order_id text,
  provider_payment_id text,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'INR',
  status public.payment_status not null default 'pending',
  method text,
  verified_via text,
  verified_at timestamptz,
  failure_reason text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount check (amount >= 0),
  constraint payments_verified_via check (verified_via is null or verified_via in ('webhook', 'server_check', 'manual'))
);
create unique index payments_provider_payment_key on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;
create unique index payments_provider_order_key on public.payments (provider, provider_order_id)
  where provider_order_id is not null;
create index payments_registration_idx on public.payments (registration_id);
create index payments_event_idx on public.payments (event_id, created_at desc);

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  signature_valid boolean not null,
  event_id uuid references public.events (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  attempts int not null default 1
);
create unique index payment_webhook_events_key on public.payment_webhook_events (provider, provider_event_id);
create index payment_webhook_events_event_idx on public.payment_webhook_events (event_id, received_at desc);

-- ---------------------------------------------------------------------------
-- Vendors (referenced by expenses)
-- ---------------------------------------------------------------------------
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete set null,
  name text not null,
  category text,
  contact_person text,
  email text,
  phone text,
  address text,
  tax_id text,
  bank_details_note text,
  rating int,
  status public.record_status not null default 'active',
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendors_rating check (rating is null or rating between 1 and 5)
);
create index vendors_event_idx on public.vendors (event_id);

-- ---------------------------------------------------------------------------
-- Documents (metadata; files live in the private `documents` bucket)
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete set null,
  category text not null default 'other',
  title text not null,
  description text,
  bucket text not null default 'documents',
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  visibility public.document_visibility not null default 'event',
  related_table text,
  related_id uuid,
  version int not null default 1,
  previous_version_id uuid references public.documents (id) on delete set null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_category check (category in (
    'invoice', 'receipt', 'sponsor_proposal', 'sponsor_agreement', 'poster', 'media_asset', 'report',
    'vendor_document', 'operational', 'other'
  )),
  constraint documents_size check (size_bytes > 0 and size_bytes <= 52428800),
  constraint documents_visibility_dept check (visibility <> 'department' or department_id is not null)
);
create unique index documents_storage_path_key on public.documents (bucket, storage_path);
create index documents_event_idx on public.documents (event_id, created_at desc);
create index documents_related_idx on public.documents (related_table, related_id);

-- ---------------------------------------------------------------------------
-- Sponsorship (declared before the ledger, which references it)
-- ---------------------------------------------------------------------------
create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  company_name text not null,
  brand_name text,
  contact_person text,
  designation text,
  email text,
  phone text,
  address text,
  website text,
  category text,
  assigned_to uuid references public.profiles (id) on delete set null,
  notes text,
  status public.record_status not null default 'active',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sponsors_event_idx on public.sponsors (event_id);

create table public.sponsorship_packages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  name text not null,
  tier_order int not null default 100,
  amount numeric(14, 2) not null default 0,
  description text,
  benefits jsonb not null default '[]'::jsonb,
  max_slots int,
  is_custom boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sponsorship_packages_amount check (amount >= 0)
);
create unique index sponsorship_packages_name_key on public.sponsorship_packages (event_id, lower(name));

create table public.sponsorship_deals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  sponsor_id uuid not null references public.sponsors (id) on delete restrict,
  package_id uuid references public.sponsorship_packages (id) on delete set null,
  stage public.sponsor_stage not null default 'lead_identified',
  proposed_amount numeric(14, 2) not null default 0,
  agreed_amount numeric(14, 2) not null default 0,
  received_amount numeric(14, 2) not null default 0,
  confirmed_at timestamptz,
  expected_payment_date date,
  owner_id uuid references public.profiles (id) on delete set null,
  agreement_document_id uuid references public.documents (id) on delete set null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sponsorship_deals_amounts check (proposed_amount >= 0 and agreed_amount >= 0 and received_amount >= 0)
);
create index sponsorship_deals_event_idx on public.sponsorship_deals (event_id, stage);
create index sponsorship_deals_sponsor_idx on public.sponsorship_deals (sponsor_id);

create table public.sponsorship_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  deal_id uuid not null references public.sponsorship_deals (id) on delete restrict,
  sponsor_id uuid not null references public.sponsors (id) on delete restrict,
  amount numeric(14, 2) not null,
  paid_on date not null,
  payment_method text not null,
  reference text,
  status public.txn_status not null default 'pending',
  receipt_document_id uuid references public.documents (id) on delete set null,
  recorded_by uuid references public.profiles (id) on delete set null,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sponsorship_payments_amount check (amount > 0)
);
create index sponsorship_payments_deal_idx on public.sponsorship_payments (deal_id);

create table public.sponsorship_deliverables (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  deal_id uuid not null references public.sponsorship_deals (id) on delete restrict,
  deliverable_type text not null,
  description text,
  due_date date,
  status public.work_status not null default 'pending',
  owner_id uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  proof_document_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sponsorship_deliverables_type check (deliverable_type in (
    'logo_placement', 'social_media', 'stage_branding', 'banner_placement', 'stall_allocation',
    'video_promotion', 'public_announcement', 'website_branding', 'other'
  ))
);
create index sponsorship_deliverables_deal_idx on public.sponsorship_deliverables (deal_id);

-- ---------------------------------------------------------------------------
-- Budgets
-- ---------------------------------------------------------------------------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  total_amount numeric(14, 2) not null default 0,
  currency char(3) not null default 'INR',
  notes text,
  set_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_amount check (total_amount >= 0)
);
create unique index budgets_event_key on public.budgets (event_id);

create table public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  budget_id uuid not null references public.budgets (id) on delete restrict,
  department_id uuid not null references public.departments (id) on delete restrict,
  allocated_amount numeric(14, 2) not null default 0,
  notes text,
  set_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_allocations_amount check (allocated_amount >= 0)
);
create unique index budget_allocations_department_key on public.budget_allocations (department_id);

create table public.budget_revisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  previous_amount numeric(14, 2) not null,
  requested_amount numeric(14, 2) not null,
  reason text not null,
  status public.request_status not null default 'pending',
  requested_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_revisions_amounts check (previous_amount >= 0 and requested_amount >= 0)
);
create index budget_revisions_event_idx on public.budget_revisions (event_id, status);

-- ---------------------------------------------------------------------------
-- Expense requests & approval history
-- ---------------------------------------------------------------------------
create table public.expense_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid not null references public.departments (id) on delete restrict,
  request_number text not null,
  title text not null,
  category text not null,
  requested_amount numeric(14, 2) not null,
  approved_amount numeric(14, 2),
  paid_amount numeric(14, 2) not null default 0,
  vendor_id uuid references public.vendors (id) on delete set null,
  description text,
  request_date date not null default current_date,
  required_by date,
  status public.expense_status not null default 'draft',
  invoice_document_id uuid references public.documents (id) on delete set null,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_requests_amounts check (
    requested_amount > 0 and (approved_amount is null or approved_amount >= 0) and paid_amount >= 0
  ),
  constraint expense_requests_paid_le_approved check (approved_amount is null or paid_amount <= approved_amount),
  constraint expense_requests_category check (category in (
    'marketing', 'media_production', 'stage', 'sound_lighting', 'venue', 'food', 'accommodation',
    'transportation', 'printing', 'decorations', 'technical_equipment', 'hospitality', 'security', 'miscellaneous'
  ))
);
create unique index expense_requests_number_key on public.expense_requests (event_id, request_number);
create index expense_requests_event_status_idx on public.expense_requests (event_id, status);
create index expense_requests_department_idx on public.expense_requests (department_id);

create table public.expense_approvals (
  id uuid primary key default gen_random_uuid(),
  expense_request_id uuid not null references public.expense_requests (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  action public.approval_action not null,
  from_status public.expense_status,
  to_status public.expense_status not null,
  amount numeric(14, 2),
  comment text,
  created_at timestamptz not null default now()
);
create index expense_approvals_request_idx on public.expense_approvals (expense_request_id, created_at);

-- ---------------------------------------------------------------------------
-- Financial ledger — append-only. Corrections use reversal/adjustment entries.
-- ---------------------------------------------------------------------------
create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  txn_number text not null,
  kind public.txn_kind not null,
  direction public.txn_direction not null,
  category text not null,
  amount numeric(14, 2) not null,
  currency char(3) not null default 'INR',
  occurred_on date not null default current_date,
  description text,
  payment_method text,
  payment_reference text,
  status public.txn_status not null default 'pending',
  registration_id uuid references public.registrations (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,
  sponsor_id uuid references public.sponsors (id) on delete restrict,
  sponsorship_payment_id uuid references public.sponsorship_payments (id) on delete restrict,
  expense_request_id uuid references public.expense_requests (id) on delete restrict,
  reverses_transaction_id uuid references public.financial_transactions (id) on delete restrict,
  document_id uuid references public.documents (id) on delete set null,
  recorded_by uuid references public.profiles (id) on delete set null,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_transactions_amount check (amount > 0),
  constraint financial_transactions_direction check (
    (kind = 'income' and direction = 'in') or
    (kind in ('expense', 'refund') and direction = 'out') or
    (kind in ('reversal', 'adjustment'))
  ),
  constraint financial_transactions_reversal_ref check ((kind = 'reversal') = (reverses_transaction_id is not null)),
  constraint financial_transactions_verified check ((status = 'verified') <= (verified_at is not null)),
  constraint financial_transactions_income_category check (kind <> 'income' or category in (
    'online_registration', 'offline_registration', 'sponsorship', 'brand_partnership', 'stall_booking',
    'ticket_sales', 'merchandise', 'donation', 'other'
  ))
);
create unique index financial_transactions_number_key on public.financial_transactions (event_id, txn_number);
-- A gateway payment or sponsorship payment can be booked as income only once.
create unique index financial_transactions_payment_once on public.financial_transactions (payment_id)
  where payment_id is not null and kind = 'income';
create unique index financial_transactions_sponsorship_once on public.financial_transactions (sponsorship_payment_id)
  where sponsorship_payment_id is not null and kind = 'income';
create unique index financial_transactions_reversed_once on public.financial_transactions (reverses_transaction_id)
  where reverses_transaction_id is not null;
create index financial_transactions_event_date_idx on public.financial_transactions (event_id, occurred_on desc, created_at desc);
create index financial_transactions_expense_idx on public.financial_transactions (expense_request_id);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  parent_task_id uuid references public.tasks (id) on delete cascade,
  module text not null default 'general',
  task_type text,
  title text not null,
  description text,
  status public.task_status not null default 'not_started',
  priority public.task_priority not null default 'medium',
  progress_pct int not null default 0,
  start_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  location text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_len check (char_length(title) between 2 and 200),
  constraint tasks_progress check (progress_pct between 0 and 100),
  constraint tasks_module check (module in ('general', 'media', 'marketing', 'operations', 'sponsorship', 'finance', 'registration')),
  constraint tasks_dates check (start_at is null or due_at is null or due_at >= start_at)
);
create index tasks_event_idx on public.tasks (event_id, status);
create index tasks_department_idx on public.tasks (department_id, status);
create index tasks_due_idx on public.tasks (event_id, due_at) where status <> 'completed';
create index tasks_parent_idx on public.tasks (parent_task_id);

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index task_assignments_active_key on public.task_assignments (task_id, user_id) where unassigned_at is null;
create index task_assignments_user_idx on public.task_assignments (user_id) where unassigned_at is null;

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_comments_body check (char_length(body) between 1 and 5000)
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Communication
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  scope public.announcement_scope not null,
  college_id uuid references public.colleges (id) on delete restrict,
  event_id uuid references public.events (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  title text not null,
  body text not null,
  priority text not null default 'normal',
  pinned boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_priority check (priority in ('normal', 'important', 'urgent')),
  constraint announcements_scope_targets check (
    (scope = 'global' and college_id is null and event_id is null and department_id is null) or
    (scope = 'college' and college_id is not null and event_id is null and department_id is null) or
    (scope = 'event' and event_id is not null and department_id is null) or
    (scope = 'department' and event_id is not null and department_id is not null)
  )
);
create index announcements_event_idx on public.announcements (event_id, published_at desc);
create index announcements_college_idx on public.announcements (college_id, published_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  name text not null,
  location text,
  capacity int,
  facilities text,
  contact_person text,
  contact_phone text,
  notes text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venues_capacity check (capacity is null or capacity > 0)
);
create index venues_event_idx on public.venues (event_id);

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete set null,
  venue_id uuid references public.venues (id) on delete set null,
  name text not null,
  category text,
  quantity int not null default 1,
  unit text not null default 'unit',
  status text not null default 'required',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_quantity check (quantity >= 0),
  constraint inventory_status check (status in ('required', 'requested', 'arranged', 'in_use', 'returned', 'damaged', 'lost'))
);
create index inventory_event_idx on public.inventory (event_id);

create table public.event_schedules (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete set null,
  venue_id uuid references public.venues (id) on delete set null,
  competition_id uuid references public.event_competitions (id) on delete set null,
  title text not null,
  description text,
  item_type text not null default 'session',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  assigned_team text,
  status public.schedule_status not null default 'scheduled',
  is_public boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_schedules_dates check (ends_at is null or ends_at >= starts_at)
);
create index event_schedules_event_idx on public.event_schedules (event_id, starts_at);

create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  name text not null,
  role text not null,
  phone text not null,
  alt_phone text,
  notes text,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index emergency_contacts_event_idx on public.emergency_contacts (event_id);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  document_id uuid references public.documents (id) on delete set null,
  title text not null,
  asset_type text not null,
  platform text,
  status public.media_asset_status not null default 'draft',
  published_url text,
  scheduled_for timestamptz,
  reach int,
  engagement int,
  uploaded_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_assets_type check (asset_type in (
    'photo', 'video', 'poster', 'reel', 'press_release', 'social_post', 'coverage', 'other'
  ))
);
create index media_assets_event_idx on public.media_assets (event_id, status);

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  department_id uuid references public.departments (id) on delete set null,
  name text not null,
  objective text,
  platform text not null,
  channel_type text not null default 'online',
  status public.campaign_status not null default 'planned',
  start_date date,
  end_date date,
  budget numeric(14, 2) not null default 0,
  actual_spend numeric(14, 2) not null default 0,
  reach int not null default 0,
  impressions int not null default 0,
  engagement int not null default 0,
  registrations_generated int not null default 0,
  owner_id uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_campaigns_amounts check (budget >= 0 and actual_spend >= 0),
  constraint marketing_campaigns_metrics check (reach >= 0 and impressions >= 0 and engagement >= 0 and registrations_generated >= 0),
  constraint marketing_campaigns_channel check (channel_type in ('online', 'offline', 'ambassador', 'influencer')),
  constraint marketing_campaigns_dates check (start_date is null or end_date is null or end_date >= start_date)
);
create index marketing_campaigns_event_idx on public.marketing_campaigns (event_id);

-- ---------------------------------------------------------------------------
-- Activity feed (curated, human readable) and audit log (complete, raw)
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete cascade,
  college_id uuid references public.colleges (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  activity_type text not null,
  summary text not null,
  entity_type text,
  entity_id uuid,
  required_permission text not null default 'event.view',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_event_idx on public.activity_log (event_id, created_at desc);
create index activity_log_college_idx on public.activity_log (college_id, created_at desc);
create index activity_log_created_idx on public.activity_log (created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  college_id uuid,
  event_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  context jsonb not null default '{}'::jsonb
);
create index audit_logs_event_idx on public.audit_logs (event_id, occurred_at desc);
create index audit_logs_college_idx on public.audit_logs (college_id, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);

-- ---------------------------------------------------------------------------
-- Public website integration
-- ---------------------------------------------------------------------------
create table public.api_credentials (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  college_id uuid not null references public.colleges (id) on delete restrict,
  name text not null,
  environment public.api_environment not null default 'sandbox',
  key_prefix text not null,
  key_hash text not null,
  webhook_secret_hash text,
  scopes text[] not null default array['registrations:write', 'registrations:read', 'event:read']::text[],
  created_by uuid references public.profiles (id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index api_credentials_prefix_key on public.api_credentials (key_prefix);
create unique index api_credentials_hash_key on public.api_credentials (key_hash);
create index api_credentials_event_idx on public.api_credentials (event_id);

alter table public.registrations
  add constraint registrations_api_credential_fk foreign key (api_credential_id)
  references public.api_credentials (id) on delete set null;

create table public.api_integration_logs (
  id bigint generated always as identity primary key,
  event_id uuid references public.events (id) on delete cascade,
  credential_id uuid references public.api_credentials (id) on delete set null,
  direction text not null default 'inbound',
  method text not null,
  endpoint text not null,
  status_code int not null,
  request_id text,
  idempotency_key text,
  ip_address text,
  duration_ms int,
  error text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint api_integration_logs_direction check (direction in ('inbound', 'outbound', 'webhook'))
);
create index api_integration_logs_event_idx on public.api_integration_logs (event_id, created_at desc);

create table app.api_idempotency_keys (
  credential_id uuid not null references public.api_credentials (id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (credential_id, idempotency_key)
);

create table app.rate_limit_buckets (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

-- ---------------------------------------------------------------------------
-- updated_at + scope guard triggers for every event-scoped table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'event_competitions', 'registrations', 'registration_items', 'payments', 'vendors', 'documents',
    'sponsors', 'sponsorship_packages', 'sponsorship_deals', 'sponsorship_payments', 'sponsorship_deliverables',
    'budgets', 'budget_allocations', 'budget_revisions', 'expense_requests', 'financial_transactions',
    'tasks', 'task_assignments', 'task_comments', 'venues', 'inventory', 'event_schedules',
    'emergency_contacts', 'media_assets', 'marketing_campaigns', 'api_credentials'
  ]
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.scope_guard()', t || '_scope', t);
  end loop;

  foreach t in array array['expense_approvals', 'activity_log']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.scope_guard()', t || '_scope', t);
  end loop;

  execute 'create trigger announcements_touch before update on public.announcements for each row execute function app.touch_updated_at()';
end $$;

-- Child rows inherit their parent's event (prevents attaching to another event's parent).
create or replace function app.inherit_parent_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  case tg_table_name
    when 'registration_items' then select event_id into v_event from public.registrations where id = new.registration_id;
    when 'task_assignments' then select event_id into v_event from public.tasks where id = new.task_id;
    when 'task_comments' then select event_id into v_event from public.tasks where id = new.task_id;
    when 'expense_approvals' then select event_id into v_event from public.expense_requests where id = new.expense_request_id;
    when 'sponsorship_deals' then select event_id into v_event from public.sponsors where id = new.sponsor_id;
    when 'sponsorship_payments' then select event_id into v_event from public.sponsorship_deals where id = new.deal_id;
    when 'sponsorship_deliverables' then select event_id into v_event from public.sponsorship_deals where id = new.deal_id;
    when 'budget_allocations' then select event_id into v_event from public.budgets where id = new.budget_id;
    else v_event := new.event_id;
  end case;
  if v_event is null then
    raise exception 'Parent record not found' using errcode = '23503';
  end if;
  new.event_id := v_event;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'registration_items', 'task_assignments', 'task_comments', 'expense_approvals',
    'sponsorship_deals', 'sponsorship_payments', 'sponsorship_deliverables', 'budget_allocations'
  ]
  loop
    -- "a_" prefix → fires before the scope guard.
    execute format('create trigger %I before insert on public.%I for each row execute function app.inherit_parent_event()', t || '_a_parent', t);
  end loop;
end $$;

-- sponsorship_payments.sponsor_id must match the deal's sponsor.
create or replace function app.guard_sponsorship_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select d.sponsor_id into new.sponsor_id from public.sponsorship_deals d where d.id = new.deal_id;
  return new;
end $$;
create trigger sponsorship_payments_b_sponsor before insert or update on public.sponsorship_payments
  for each row execute function app.guard_sponsorship_payment();

-- Subtasks share their parent's event/department lineage.
create or replace function app.guard_subtask() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_task_id is not null and not exists (
    select 1 from public.tasks p where p.id = new.parent_task_id and p.event_id = new.event_id
  ) then
    raise exception 'Parent task belongs to a different event' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tasks_b_subtask before insert or update on public.tasks
  for each row execute function app.guard_subtask();

-- Announcements: derive college from event/department scope.
create or replace function app.guard_announcement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.department_id is not null then
    select d.event_id into new.event_id from public.departments d where d.id = new.department_id;
  end if;
  if new.event_id is not null then
    select e.college_id into new.college_id from public.events e where e.id = new.event_id;
  end if;
  return new;
end $$;
create trigger announcements_guard before insert or update on public.announcements
  for each row execute function app.guard_announcement();
