# Fase A — Master Data + Inventory Core

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Part of:** ERP Vobia buildout (Fase A → B → C → D)

## Context

Vobia is a multi-tenant fashion-brand ERP on Next.js + Supabase (Postgres, RLS).
Phase 1 shipped 7 modules: product spine (styles → colorways → skus), stock
ledger, production + vendors, costing, channels + orders, returns.

Current inventory model:
- `stock_ledger` is append-only; `record_movement()` (security definer) is its
  only writer. Movement types: `production_in`, `sale_out`, `return_in`,
  `adjustment`.
- `stock_balances` view = `sum(qty)` per (sku, tenant).
- Everything is SKU-based (finished goods only). **No location dimension.**

This is the first of four phases that complete the ERP. Full scope decided:
double-entry GL, retail/marketplace sales only (no B2B credit terms), build
order A → B → C → D.

## Scope of Fase A

**In:**
1. Multi-location inventory: `locations` master, location-aware `stock_ledger`,
   location-aware balances.
2. Stock transfer between locations.
3. Stock opname (physical count) posting adjustments.
4. Material master: raw-material catalog (fabric, trims). Catalog only — no
   material stock tracking yet.

**Out (deliberate, with rationale):**
- **Customer master** — sales are retail/marketplace; customer is optional and
  channel is the primary axis. `orders.customer` (text) stays. Add a customer
  table later only if repeat-buyer analytics/loyalty is needed.
- **`stock_counts` session table** — opname posts `adjustment` rows directly
  with reason `opname`. Add a count-session header/line table later only if
  audit history of physical counts is required.
- **Material stock ledger** — raw materials get stock movements in Fase B, when
  purchasing (goods receipt) actually creates them. Fase A ships the catalog
  only. YAGNI until there is a writer.

## Data Model

All new tables follow the existing pattern: `tenant_id` defaulted from
`auth.jwt() ->> 'tenant_id'`, RLS `tenant_isolation` policy, per-tenant unique
keys.

### `locations`
```
id           uuid pk
tenant_id    uuid not null → tenants(id), default from JWT
name         text not null
is_default   boolean not null default false
active       boolean not null default true
created_at   timestamptz not null default now()
unique (tenant_id, name)
```
- Exactly one `is_default = true` per tenant (partial unique index).
- Migration seeds one default location per existing tenant ("Gudang Utama").

### `materials`
```
id           uuid pk
tenant_id    uuid not null → tenants(id), default from JWT
code         text not null
name         text not null
category     text not null check in ('fabric','trim','accessory','other')
uom          text not null   -- unit of measure: 'm','pcs','roll','kg','other'
active       boolean not null default true
created_at   timestamptz not null default now()
unique (tenant_id, code)
```
- Catalog only in Fase A. No stock rows, no ledger references yet.

### `stock_ledger` (altered)
- Add `location_id uuid not null → locations(id)`.
- Extend `movement_type` check to include `transfer_in`, `transfer_out`.
- Backfill: every existing row gets its tenant's default location.
- Column added as nullable → backfill → set not null, to keep the migration
  safe on existing data.

## Functions

### `record_movement()` (altered — non-breaking)
- Add trailing param `p_location_id uuid default null`.
- If `p_location_id is null`, resolve to the caller's tenant default location.
- Validate the location belongs to the caller's tenant (same guard style as the
  existing sku-tenant check).
- All existing callers (production receive, sale_out, return_in) keep working
  unchanged — they omit the new param and land in the default location.

### `record_transfer()` (new)
```
record_transfer(p_sku_id uuid, p_qty integer,
                p_from_location uuid, p_to_location uuid,
                p_reason text default null) returns void
```
- Security definer, `search_path = public`.
- Guards: qty > 0; from ≠ to; both locations same tenant; sku same tenant;
  sufficient balance at `p_from_location` (reject overdraw).
- Writes two ledger rows in one statement/transaction:
  `transfer_out` (−qty) at from, `transfer_in` (+qty) at to.
- Conserves total sku balance across locations.

## Views

### `stock_balances_by_location` (new)
```
select sku_id, location_id, tenant_id, sum(qty)::int as balance
from stock_ledger group by sku_id, location_id, tenant_id;
```

### `stock_balances` (unchanged)
- Stays as total per (sku, tenant). Existing UI depends on it; not touched.

## UI

- **Lokasi** (settings): CRUD locations; toggle active; set default.
- **Bahan** (new nav item): CRUD materials (code, name, category, uom, active).
- **Stok** (existing page, extended):
  - Show balance per location (via `stock_balances_by_location`), plus total.
  - **Transfer** action: pick sku, from-location, to-location, qty → calls
    `record_transfer`.
  - **Opname** flow: pick location, enter counted qty per sku → for each sku
    where counted ≠ balance, post `adjustment` (delta, reason `opname`) via
    `record_movement`.

## Error Handling

- `record_transfer` raises on: overdraw, from = to, cross-tenant location/sku,
  qty ≤ 0 — mirroring `record_movement`'s existing raise style.
- Opname posts nothing for skus where counted == current balance.
- Location delete is blocked while ledger rows reference it (FK restrict);
  deactivate instead.

## Testing

1. Transfer conserves total: sum(sku balance) before == after a transfer.
2. Transfer overdraw is rejected.
3. Opname: posted adjustment delta == counted − prior balance, per sku.
4. `record_movement` with null location → row lands in tenant default location.
5. RLS: a tenant cannot see or write another tenant's `locations` / `materials`.
6. Existing callers unaffected: production receive / sale_out / return_in still
   post correctly (regression via existing E2E).

## Migration Order

1. `locations` (+ seed defaults per tenant).
2. `materials`.
3. `stock_ledger`: add `location_id` nullable → backfill → not null; extend
   movement_type check.
4. `record_movement` replace (add param + default-location resolution).
5. `record_transfer` create.
6. `stock_balances_by_location` view.

## Dependencies / Downstream

- Fase B (purchasing + BOM) reuses `materials` and adds the material stock
  ledger + goods receipt that writes it.
- Fase D (GL) will post inventory value from location-aware balances.
