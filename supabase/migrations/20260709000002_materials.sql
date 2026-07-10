create table public.materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  name text not null,
  category text not null check (category in ('fabric','trim','accessory','other')),
  uom text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

alter table public.materials enable row level security;
create policy tenant_isolation on public.materials for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.materials to authenticated;
