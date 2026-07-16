-- P3: PO anak ber-tipe di bawah PPO (FOB 1:1, CMT 1:N) + status pembayaran per PO.
alter table public.purchase_orders
  add column ppo_id uuid references public.ppo(id),
  add column po_type text not null default 'material'
    check (po_type in ('material','finished','sewing','bordir','accessory')),
  add column amount numeric(14,2) not null default 0 check (amount >= 0);
create index purchase_orders_ppo_idx on public.purchase_orders(ppo_id) where ppo_id is not null;

-- SPK produksi bisa ditautkan ke PPO (CMT: vendor jahit = production order existing)
alter table public.production_orders
  add column ppo_id uuid references public.ppo(id);

create table public.po_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  kind text not null check (kind in ('dp','settlement','full')),
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index po_payments_po_idx on public.po_payments(po_id);

alter table public.po_payments enable row level security;
create policy tenant_isolation on public.po_payments for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.po_payments to authenticated;
