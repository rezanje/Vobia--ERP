create table public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  sku_id uuid not null references public.skus(id),
  qty integer not null,
  movement_type text not null
    check (movement_type in ('production_in','sale_out','return_in','adjustment')),
  reason text,
  ref_type text,
  ref_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint qty_nonzero check (qty <> 0),
  constraint adjustment_reason check (
    movement_type <> 'adjustment' or (reason is not null and trim(reason) <> '')
  )
);
create index stock_ledger_sku_id_idx on public.stock_ledger(sku_id);
create index stock_ledger_tenant_created_idx on public.stock_ledger(tenant_id, created_at desc);

alter table public.stock_ledger enable row level security;
create policy tenant_isolation on public.stock_ledger
  for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- append-only: no direct writes; record_movement() is the only writer
revoke insert, update, delete on public.stock_ledger from authenticated;
grant select on public.stock_ledger to authenticated;

create view public.stock_balances with (security_invoker = on) as
select sku_id, tenant_id, sum(qty)::int as balance
from public.stock_ledger
group by sku_id, tenant_id;

grant select on public.stock_balances to authenticated;
