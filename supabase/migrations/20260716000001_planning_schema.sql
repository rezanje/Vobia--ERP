-- P1: forecast (sales/ops) -> alignment -> projection (locked) + produk baru R&D/marketing
create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  kind text not null check (kind in ('sales','ops')),
  period text not null, -- 'YYYY-Qn'
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, kind, period)
);

create table public.forecast_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  forecast_id uuid not null references public.forecasts(id) on delete cascade,
  style_id uuid not null references public.styles(id),
  qty integer not null check (qty >= 0),
  -- KPI rekomendasi ops (manual dulu; auto-hitung dari ledger = nanti)
  ito numeric(8,2),
  stock_ratio numeric(8,2),
  unique (tenant_id, forecast_id, style_id)
);
create index forecast_lines_forecast_idx on public.forecast_lines(forecast_id);

create table public.new_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  name text not null,
  style_id uuid references public.styles(id),
  rnd_status text not null default 'design' check (rnd_status in ('design','prototype','done')),
  mkt_status text not null default 'belum' check (mkt_status in ('belum','cek_ombak','tervalidasi')),
  agreed_qty integer check (agreed_qty > 0),
  notes text,
  created_at timestamptz not null default now()
);

create table public.projections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  period text not null,
  status text not null default 'draft' check (status in ('draft','locked')),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, period)
);

create table public.projection_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  projection_id uuid not null references public.projections(id) on delete cascade,
  style_id uuid not null references public.styles(id),
  qty integer not null check (qty > 0),
  kind text not null default 'regular' check (kind in ('regular','seasonal_new')),
  new_product_id uuid references public.new_products(id),
  unique (tenant_id, projection_id, style_id)
);
create index projection_lines_projection_idx on public.projection_lines(projection_id);

alter table public.forecasts enable row level security;
alter table public.forecast_lines enable row level security;
alter table public.new_products enable row level security;
alter table public.projections enable row level security;
alter table public.projection_lines enable row level security;

create policy tenant_isolation on public.forecasts for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.forecast_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.new_products for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.projections for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.projection_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.forecasts to authenticated;
grant select, insert, update, delete on public.forecast_lines to authenticated;
grant select, insert, update, delete on public.new_products to authenticated;
grant select, insert, update, delete on public.projections to authenticated;
grant select, insert, update, delete on public.projection_lines to authenticated;

-- projection locked = immutable (lines + header)
create or replace function public.guard_locked_projection() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.projections
    where id = coalesce(new.projection_id, old.projection_id);
  if v_status = 'locked' then raise exception 'projection is locked'; end if;
  return coalesce(new, old);
end;
$$;
create trigger projection_lines_lock_guard
  before insert or update or delete on public.projection_lines
  for each row execute function public.guard_locked_projection();

create or replace function public.guard_locked_projection_header() returns trigger
language plpgsql as $$
begin
  if old.status = 'locked' then raise exception 'projection is locked'; end if;
  return coalesce(new, old);
end;
$$;
create trigger projections_lock_guard
  before update or delete on public.projections
  for each row execute function public.guard_locked_projection_header();
