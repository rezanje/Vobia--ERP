-- P2 PPIC: PCB kuartalan (Production Cost Breakdown) + PPO (Parent Purchase Order)
create table public.pcb (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  quarter text not null, -- 'YYYY-Qn'
  projection_id uuid not null references public.projections(id),
  status text not null default 'draft' check (status in ('draft','final')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.pcb_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  pcb_id uuid not null references public.pcb(id) on delete cascade,
  style_id uuid not null references public.styles(id),
  target_sales integer not null check (target_sales >= 0),
  ending_stock integer not null default 0 check (ending_stock >= 0),
  -- formula SOP: total kebutuhan beli = ending stock + target sales
  supply_qty integer generated always as (ending_stock + target_sales) stored,
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  total numeric(16,2) generated always as ((ending_stock + target_sales) * unit_cost) stored,
  unique (tenant_id, pcb_id, style_id)
);
create index pcb_lines_pcb_idx on public.pcb_lines(pcb_id);

create table public.ppo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  pcb_id uuid not null references public.pcb(id),
  style_id uuid not null references public.styles(id),
  scheme text not null check (scheme in ('fob','cmt')),
  qty integer not null check (qty > 0),
  status text not null default 'draft' check (status in ('draft','issued','closed')),
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index ppo_tenant_status_idx on public.ppo(tenant_id, status);

alter table public.pcb enable row level security;
alter table public.pcb_lines enable row level security;
alter table public.ppo enable row level security;
create policy tenant_isolation on public.pcb for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.pcb_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.ppo for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.pcb to authenticated;
grant select, insert, update, delete on public.pcb_lines to authenticated;
grant select, insert, update, delete on public.ppo to authenticated;
