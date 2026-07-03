create table public.returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  order_id uuid not null references public.orders(id),
  return_date date not null default current_date,
  reason text,
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index returns_tenant_date_idx on public.returns(tenant_id, return_date desc);

create table public.return_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  return_id uuid not null references public.returns(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now()
);
create index return_lines_return_id_idx on public.return_lines(return_id);

alter table public.returns enable row level security;
alter table public.return_lines enable row level security;

create policy tenant_isolation on public.returns for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.return_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.returns to authenticated;
grant select, insert, update, delete on public.return_lines to authenticated;
