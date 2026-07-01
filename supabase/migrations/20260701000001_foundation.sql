create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  role text not null default 'viewer'
    check (role in ('owner','ops','production','inventory','finance','viewer')),
  full_name text,
  created_at timestamptz not null default now()
);
create index profiles_tenant_id_idx on public.profiles(tenant_id);

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;

-- reusable tenant-isolation template (copy for every future ber-tenant_id table)
create policy tenant_isolation on public.profiles
  for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- bootstrap: read own profile via uid even before tenant_id claim exists
create policy self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy own_tenant on public.tenants
  for select to authenticated
  using (id = (auth.jwt() ->> 'tenant_id')::uuid);

-- explicit table grants: RLS gates rows, but the authenticated role still needs
-- the table-level privilege or queries error instead of returning 0 rows.
grant select on public.tenants to authenticated;
grant select on public.profiles to authenticated;
