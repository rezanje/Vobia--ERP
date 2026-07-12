-- Draft→approved document layer for production orders and material POs.
-- Orthogonal to production_orders.stage and purchase_orders.status.
alter table public.production_orders
  add column doc_status text not null default 'draft'
    check (doc_status in ('draft','approved')),
  add column approved_by uuid references auth.users(id),
  add column approved_at timestamptz;

alter table public.purchase_orders
  add column doc_status text not null default 'draft'
    check (doc_status in ('draft','approved')),
  add column approved_by uuid references auth.users(id),
  add column approved_at timestamptz;

-- Backfill existing rows (seed/simulation) as approved so already-issued /
-- already-received orders stay valid under the new gate.
update public.production_orders set doc_status = 'approved', approved_at = created_at
  where doc_status = 'draft';
update public.purchase_orders set doc_status = 'approved', approved_at = created_at
  where doc_status = 'draft';
