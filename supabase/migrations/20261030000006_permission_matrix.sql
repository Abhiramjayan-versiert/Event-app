-- ============================================================================
-- EVENT APP — Migration 6: Default roles & permission matrix
-- Reference configuration (not sample data). The Super Admin can edit grants
-- from Settings → Roles & Permissions; system roles cannot be deleted.
-- ============================================================================

insert into public.permissions (key, module, name, scope, sort_order, description) values
  -- College
  ('college.view',            'colleges',      'View college',                'college', 10, 'View the college workspace and all of its events'),
  ('college.manage',          'colleges',      'Manage college',              'college', 11, 'Edit college profile and branding'),
  ('college.users.manage',    'colleges',      'Manage college users',        'college', 12, 'Invite users and manage college administrators'),
  ('college.events.create',   'colleges',      'Create events',               'college', 13, 'Create new events under the college'),
  -- Event
  ('event.view',              'events',        'View event',                  'event',   20, 'Access the event workspace and dashboard'),
  ('event.manage',            'events',        'Manage event',                'event',   21, 'Edit event details, branding and settings'),
  ('event.close',             'events',        'Close event',                 'event',   22, 'Initiate and approve the financial closure of the event'),
  ('event.members.manage',    'events',        'Manage event team',           'event',   23, 'Appoint event administrators and remove users from the event'),
  ('departments.manage',      'departments',   'Manage departments',          'event',   30, 'Create departments and appoint heads / assistant heads'),
  ('finance.view',            'finance',       'View finances',               'event',   40, 'View the financial dashboard, ledger and all expense requests'),
  ('finance.manage',          'finance',       'Manage finances',             'event',   41, 'Record and verify income, record payments, upload receipts'),
  ('finance.review',          'finance',       'Review expenses',             'event',   42, 'Review expense requests: approve within limit, reject, request changes, forward'),
  ('finance.approve',         'finance',       'Final expense approval',      'event',   43, 'Approve expense requests above the review limit'),
  ('budgets.manage',          'finance',       'Manage budgets',              'event',   44, 'Set the event budget, allocate department budgets, decide revisions'),
  ('expenses.submit',         'finance',       'Submit expenses (any dept)',  'event',   45, 'Submit expense requests on behalf of any department'),
  ('registrations.view',      'registrations', 'View registrations',          'event',   50, 'View participant data and registration statistics'),
  ('registrations.manage',    'registrations', 'Manage registrations',        'event',   51, 'Verify offline registrations, cancellations and refunds'),
  ('registrations.export',    'registrations', 'Export registrations',        'event',   52, 'Export participant lists'),
  ('sponsors.view',           'sponsorship',   'View sponsorship',            'event',   60, 'View sponsors, deals and deliverables'),
  ('sponsors.manage',         'sponsorship',   'Manage sponsorship',          'event',   61, 'Manage the sponsor pipeline, packages and deliverables'),
  ('media.view',              'media',         'View media',                  'event',   70, 'View media calendar and assets'),
  ('media.manage',            'media',         'Manage media',                'event',   71, 'Manage media tasks, assets and approvals'),
  ('marketing.view',          'marketing',     'View marketing',              'event',   80, 'View marketing campaigns and performance'),
  ('marketing.manage',        'marketing',     'Manage marketing',            'event',   81, 'Manage campaigns, budgets and performance entries'),
  ('tasks.view_all',          'tasks',         'View all tasks',              'event',   90, 'View every task in the event'),
  ('tasks.manage_all',        'tasks',         'Manage all tasks',            'event',   91, 'Create and assign tasks in any department'),
  ('operations.view',         'operations',    'View operations',             'event',  100, 'View venues, vendors, inventory and logistics'),
  ('operations.manage',       'operations',    'Manage operations',           'event',  101, 'Manage venues, vendors, inventory and the master schedule'),
  ('announcements.manage',    'communication', 'Event announcements',         'event',  110, 'Publish event-wide announcements'),
  ('documents.view_all',      'documents',     'View all documents',          'event',  120, 'View every document in the event regardless of visibility'),
  ('reports.view',            'reports',       'View reports',                'event',  130, 'View reports permitted by other module permissions'),
  ('reports.export',          'reports',       'Export reports',              'event',  131, 'Export reports as CSV, XLSX or PDF'),
  ('integrations.manage',     'integrations',  'Manage integrations',         'event',  140, 'Manage API credentials and website integration'),
  ('audit.view',              'audit',         'View audit log',              'event',  150, 'View the event audit trail'),
  -- Department-scoped (apply only to the department the role is held in)
  ('department.view',         'departments',   'View department',             'department', 200, 'View the department workspace'),
  ('department.manage',       'departments',   'Manage department',           'department', 201, 'Edit department details and progress'),
  ('department.members.manage','departments',  'Manage team members',         'department', 202, 'Add and remove department team members'),
  ('tasks.view',              'tasks',         'View department tasks',       'department', 210, 'View all tasks of the department'),
  ('tasks.manage',            'tasks',         'Manage department tasks',     'department', 211, 'Create, assign and edit department tasks'),
  ('expenses.view',           'finance',       'View department expenses',    'department', 220, 'View the department''s expense requests'),
  ('budgets.view',            'finance',       'View department budget',      'department', 222, 'View the department budget allocation'),
  ('budgets.request',         'finance',       'Request budget revision',     'department', 223, 'Request a revision of the department budget'),
  ('documents.view',          'documents',     'View department documents',   'department', 230, 'View department documents'),
  ('documents.upload',        'documents',     'Upload documents',            'department', 231, 'Upload documents to the department'),
  ('announcements.post',      'communication', 'Department announcements',    'department', 240, 'Publish department announcements'),
  ('operations.update',       'operations',    'Update operations',           'department', 250, 'Maintain the department''s schedule items, vendors and inventory')
on conflict (key) do nothing;

-- expenses.submit also exists as a department-scoped grant through this alias row.
insert into public.permissions (key, module, name, scope, sort_order, description) values
  ('expenses.submit_department', 'finance', 'Submit department expenses', 'department', 221, 'Submit expense requests for the department')
on conflict (key) do nothing;

insert into public.roles (key, name, scope, is_system, sort_order, description) values
  ('super_admin',       'Super Admin',       'global',     true,  1, 'Platform owner with global access. Granted via the profile flag, never via membership.'),
  ('college_admin',     'College Admin',     'college',    true, 10, 'Manages a college, its users and all of its events'),
  ('event_admin',       'Event Admin',       'event',      true, 20, 'Runs an event end to end'),
  ('event_viewer',      'Event Observer',    'event',      true, 25, 'Read-only access to the event overview'),
  ('finance_head',      'Finance Head',      'department', true, 30, 'Leads the finance department'),
  ('registration_head', 'Registration Head', 'department', true, 31, 'Leads participant registration'),
  ('sponsorship_head',  'Sponsorship Head',  'department', true, 32, 'Leads sponsorship acquisition and delivery'),
  ('media_head',        'Media & PR Head',   'department', true, 33, 'Leads media, PR and content'),
  ('marketing_head',    'Marketing Head',    'department', true, 34, 'Leads marketing campaigns'),
  ('department_head',   'Department Head',   'department', true, 40, 'Leads any other department'),
  ('assistant_head',    'Assistant Head',    'department', true, 41, 'Supports the department head'),
  ('team_member',       'Team Member',       'department', true, 50, 'Works on assigned tasks')
on conflict (key) do nothing;

-- Helper to grant a list of permission keys to a role.
create or replace function app.grant_permissions(p_role text, p_keys text[]) returns void
language sql as $$
  insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r cross join public.permissions p
  where r.key = p_role and p.key = any(p_keys)
  on conflict do nothing
$$;

-- College admin: everything within their college.
select app.grant_permissions('college_admin', array(select key from public.permissions));

-- Event admin: every event and department permission.
select app.grant_permissions('event_admin', array(select key from public.permissions where scope in ('event', 'department')));

select app.grant_permissions('event_viewer', array['event.view']);

-- Common department-head toolkit.
create temporary table _dept_head_perms as
select unnest(array[
  'event.view', 'department.view', 'department.manage', 'department.members.manage', 'tasks.view', 'tasks.manage',
  'expenses.view', 'expenses.submit_department', 'budgets.view', 'budgets.request', 'documents.view', 'documents.upload',
  'announcements.post', 'operations.update', 'reports.view'
]) as key;

select app.grant_permissions('department_head', array(select key from _dept_head_perms));

select app.grant_permissions('finance_head', array(select key from _dept_head_perms) || array[
  'finance.view', 'finance.manage', 'finance.review', 'registrations.view', 'sponsors.view', 'reports.export'
]);
select app.grant_permissions('registration_head', array(select key from _dept_head_perms) || array[
  'registrations.view', 'registrations.manage', 'registrations.export', 'reports.export'
]);
select app.grant_permissions('sponsorship_head', array(select key from _dept_head_perms) || array[
  'sponsors.view', 'sponsors.manage'
]);
select app.grant_permissions('media_head', array(select key from _dept_head_perms) || array[
  'media.view', 'media.manage'
]);
select app.grant_permissions('marketing_head', array(select key from _dept_head_perms) || array[
  'marketing.view', 'marketing.manage'
]);

select app.grant_permissions('assistant_head', array[
  'event.view', 'department.view', 'tasks.view', 'tasks.manage', 'expenses.view', 'expenses.submit_department',
  'budgets.view', 'documents.view', 'documents.upload', 'announcements.post', 'operations.update'
]);

select app.grant_permissions('team_member', array[
  'event.view', 'department.view', 'documents.view', 'documents.upload'
]);

drop table _dept_head_perms;
