create table public.styles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  name text not null,
  collection text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.colorways (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  style_id uuid not null references public.styles(id) on delete cascade,
  color_name text not null,
  color_code text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, style_id, color_code)
);
create index colorways_style_id_idx on public.colorways(style_id);

create table public.skus (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  colorway_id uuid not null references public.colorways(id) on delete cascade,
  size text not null,
  sku_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, sku_code),
  unique (tenant_id, colorway_id, size)
);
create index skus_colorway_id_idx on public.skus(colorway_id);

alter table public.styles enable row level security;
alter table public.colorways enable row level security;
alter table public.skus enable row level security;

create policy tenant_isolation on public.styles
  for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.colorways
  for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.skus
  for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.styles to authenticated;
grant select, insert, update, delete on public.colorways to authenticated;
grant select, insert, update, delete on public.skus to authenticated;

create view public.style_summary
  with (security_invoker = on) as
select s.*,
  (select count(*) from public.colorways c where c.style_id = s.id) as colorway_count,
  (select count(*) from public.skus k
     join public.colorways c on c.id = k.colorway_id
     where c.style_id = s.id) as sku_count
from public.styles s;

grant select on public.style_summary to authenticated;
