create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  name text not null,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
-- at most one default per tenant
create unique index locations_one_default on public.locations(tenant_id) where is_default;

alter table public.locations enable row level security;
create policy tenant_isolation on public.locations for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.locations to authenticated;

-- seed default location for every existing tenant
insert into public.locations (tenant_id, name, is_default)
select id, 'Gudang Utama', true from public.tenants
on conflict (tenant_id, name) do nothing;

-- extend new-user handler to seed a default location alongside the tenant.
-- Same name/signature as the existing handler (20260701000002_new_user.sql) so
-- the on_auth_user_created trigger keeps pointing at it; only one insert added.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (name)
  values (coalesce(new.raw_user_meta_data->>'tenant_name', 'Tenant'))
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name)
  values (new.id, new_tenant_id, 'owner', new.raw_user_meta_data->>'full_name');

  insert into public.locations (tenant_id, name, is_default)
  values (new_tenant_id, 'Gudang Utama', true);

  return new;
end;
$$;
