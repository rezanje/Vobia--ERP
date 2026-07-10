create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  vendor_id uuid not null references public.vendors(id),
  location_id uuid not null references public.locations(id),
  order_date date not null default current_date,
  status text not null default 'open' check (status in ('open','received','canceled')),
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index purchase_orders_tenant_status_idx on public.purchase_orders(tenant_id, status);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty_ordered numeric(14,3) not null check (qty_ordered > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  qty_received numeric(14,3) not null default 0 check (qty_received >= 0),
  created_at timestamptz not null default now()
);
create index purchase_lines_po_idx on public.purchase_lines(po_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_lines enable row level security;
create policy tenant_isolation on public.purchase_orders for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.purchase_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_lines to authenticated;
