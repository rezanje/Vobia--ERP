create table public.cost_entries (
  id uuid primary key default gen_random_uuid(),
  -- ponytail: cross-tenant cost attach would need guessing a PO's uuid (RLS hides
  -- other tenants' POs). Add a validating trigger only if that becomes a real vector.
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  po_id uuid not null references public.production_orders(id) on delete cascade,
  cost_type text not null check (cost_type in ('material','cmt','overhead','other')),
  amount numeric(14,2) not null check (amount > 0),
  note text,
  created_at timestamptz not null default now()
);
create index cost_entries_po_id_idx on public.cost_entries(po_id);

alter table public.cost_entries enable row level security;
create policy tenant_isolation on public.cost_entries for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.cost_entries to authenticated;

create view public.sku_hpp with (security_invoker = on) as
with po_cost as (
  select po_id, sum(amount) as total_cost from public.cost_entries group by po_id
),
po_units as (
  select po_id, sum(qty_received) as units from public.prod_lines group by po_id
),
line_alloc as (
  select pl.tenant_id, pl.sku_id, pl.qty_received,
         coalesce(pc.total_cost, 0) / nullif(pu.units, 0) as per_unit
  from public.prod_lines pl
  join po_units pu on pu.po_id = pl.po_id
  left join po_cost pc on pc.po_id = pl.po_id
  where pl.qty_received > 0
)
select tenant_id, sku_id,
       round(sum(per_unit * qty_received) / nullif(sum(qty_received), 0), 2) as hpp,
       sum(qty_received)::int as costed_units
from line_alloc
group by tenant_id, sku_id;

grant select on public.sku_hpp to authenticated;
