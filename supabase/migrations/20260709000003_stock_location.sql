-- 1. add location_id (nullable first so existing rows survive)
alter table public.stock_ledger add column location_id uuid references public.locations(id);

-- 2. backfill every existing row to its tenant's default location
update public.stock_ledger sl
set location_id = (
  select l.id from public.locations l
  where l.tenant_id = sl.tenant_id and l.is_default
  limit 1
)
where location_id is null;

-- 3. now enforce not-null
alter table public.stock_ledger alter column location_id set not null;
create index stock_ledger_location_idx on public.stock_ledger(location_id);

-- 4. allow transfer movement types
alter table public.stock_ledger drop constraint stock_ledger_movement_type_check;
alter table public.stock_ledger add constraint stock_ledger_movement_type_check
  check (movement_type in
    ('production_in','sale_out','return_in','adjustment','transfer_in','transfer_out'));

-- 5. per-location balance view (total-per-sku view stays untouched)
create view public.stock_balances_by_location with (security_invoker = on) as
select sku_id, location_id, tenant_id, sum(qty)::int as balance
from public.stock_ledger
group by sku_id, location_id, tenant_id;

grant select on public.stock_balances_by_location to authenticated;
