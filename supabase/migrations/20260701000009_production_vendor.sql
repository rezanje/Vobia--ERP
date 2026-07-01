create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  name text not null,
  contact text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  style_id uuid not null references public.styles(id),
  vendor_id uuid not null references public.vendors(id),
  stage text not null default 'trial'
    check (stage in ('trial','mass_production','qc','completed','canceled')),
  deadline date,
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index production_orders_tenant_stage_idx on public.production_orders(tenant_id, stage);

create table public.prod_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  po_id uuid not null references public.production_orders(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  qty_ordered integer not null check (qty_ordered > 0),
  qty_received integer not null default 0 check (qty_received >= 0),
  reject_count integer not null default 0 check (reject_count >= 0),
  created_at timestamptz not null default now()
);
create index prod_lines_po_id_idx on public.prod_lines(po_id);

alter table public.vendors enable row level security;
alter table public.production_orders enable row level security;
alter table public.prod_lines enable row level security;

create policy tenant_isolation on public.vendors for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.production_orders for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.prod_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.vendors to authenticated;
grant select, insert, update, delete on public.production_orders to authenticated;
grant select, insert, update, delete on public.prod_lines to authenticated;
