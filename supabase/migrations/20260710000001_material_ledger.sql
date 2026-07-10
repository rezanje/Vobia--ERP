create table public.material_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  material_id uuid not null references public.materials(id),
  location_id uuid not null references public.locations(id),
  qty numeric(14,3) not null,
  movement_type text not null
    check (movement_type in ('purchase_in','issue_out','adjustment','transfer_in','transfer_out')),
  reason text,
  ref_type text,
  ref_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint material_qty_nonzero check (qty <> 0),
  constraint material_adjustment_reason check (
    movement_type <> 'adjustment' or (reason is not null and trim(reason) <> '')
  )
);
create index material_ledger_material_idx on public.material_ledger(material_id);
create index material_ledger_location_idx on public.material_ledger(location_id);
create index material_ledger_tenant_created_idx on public.material_ledger(tenant_id, created_at desc);

alter table public.material_ledger enable row level security;
create policy tenant_isolation on public.material_ledger
  for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- append-only: record_material_movement() is the only writer
revoke insert, update, delete on public.material_ledger from authenticated;
grant select on public.material_ledger to authenticated;

create view public.material_balances_by_location with (security_invoker = on) as
select material_id, location_id, tenant_id, sum(qty)::numeric(14,3) as balance
from public.material_ledger
group by material_id, location_id, tenant_id;

create view public.material_balances with (security_invoker = on) as
select material_id, tenant_id, sum(qty)::numeric(14,3) as balance
from public.material_ledger
group by material_id, tenant_id;

grant select on public.material_balances_by_location to authenticated;
grant select on public.material_balances to authenticated;
