-- HR + payroll.
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  name text not null,
  position text,
  placement text,
  join_date date,
  base_salary numeric(14,2) not null default 0 check (base_salary >= 0),
  bank_account text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index employees_tenant_idx on public.employees(tenant_id);

create table public.pay_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  name text not null,
  kind text not null check (kind in ('tunjangan','potongan')),
  calc text not null check (calc in ('nominal','persen')),
  value numeric(14,2) not null default 0 check (value >= 0),
  is_tax boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index pay_components_tenant_idx on public.pay_components(tenant_id);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  period text not null,
  status text not null default 'draft' check (status in ('draft','posted')),
  journal_id uuid references public.journals(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, period)
);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  base_salary numeric(14,2) not null default 0,
  tunjangan_total numeric(14,2) not null default 0,
  overtime numeric(14,2) not null default 0 check (overtime >= 0),
  deduction_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  gross numeric(14,2) generated always as (base_salary + tunjangan_total + overtime) stored,
  net numeric(14,2) generated always as (base_salary + tunjangan_total + overtime - deduction_total - tax_total) stored,
  created_at timestamptz not null default now()
);
create index payslips_run_idx on public.payslips(run_id);

create table public.payslip_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  payslip_id uuid not null references public.payslips(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('tunjangan','potongan','pajak')),
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index payslip_lines_payslip_idx on public.payslip_lines(payslip_id);

alter table public.employees enable row level security;
alter table public.pay_components enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;
alter table public.payslip_lines enable row level security;

create policy tenant_isolation on public.employees for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid) with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.pay_components for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid) with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.payroll_runs for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.payslips for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid) with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.payslip_lines for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.employees to authenticated;
grant select, insert, update, delete on public.pay_components to authenticated;
grant select on public.payroll_runs to authenticated;
grant select, update on public.payslips to authenticated;   -- update = overtime edit while draft
grant select on public.payslip_lines to authenticated;
