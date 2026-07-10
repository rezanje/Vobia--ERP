# Fase B — Material Stock + Purchasing + BOM + Issue

**Date:** 2026-07-10
**Status:** Approved (design), pending implementation plan
**Part of:** ERP Vobia buildout (Fase A ✅ → **B** → C → D)

## Context

Vobia is a multi-tenant fashion-brand ERP (Next.js 16 + Supabase, RLS). Fase A
shipped multi-location inventory for finished goods (SKUs) and a raw-material
catalog (`materials`: code, name, category, uom). `record_movement()` is the
single writer to `stock_ledger` (finished goods), now location-aware.

Production is outsourced to convection vendors. Two supply models coexist:
- **Maklon** — the vendor buys everything; Vobia orders finished goods only.
- **CMT** — Vobia buys fabric/trims and issues them to the vendor, who sews.

Key design lever: **maklon = CMT minus the material issue.** Build one material
machinery; maklon production orders simply never issue material. No mode flag.

Goal is to ship fast for a user simulation, which surfaces the real adjustments.
Scope is deliberately lean.

## Scope

**In:**
1. Material stock ledger (`material_ledger`) — location-aware, append-only, with
   `record_material_movement()` as sole writer. Decimal quantities.
2. Purchasing — `purchase_orders` + `purchase_lines`, `create_purchase_order`,
   `receive_purchase` (partial receipts) writing `purchase_in`.
3. BOM — `bom_lines` (materials per style, qty per unit).
4. Material issue to a production order — `issue_material_to_po` writing
   `issue_out`; BOM suggests quantities.
5. UI: Stok Bahan page, Pembelian (PO) page, BOM section on style detail, Issue
   section on production-order detail.

**Out (deferred, with rationale):**
- **AP bill/payment** → Fase C. Purchase captures `unit_price` only; no payable.
- **Material valuation → finished-goods HPP** → deferred. `cost_entries` (manual)
  still available; no automatic material costing.
- **Inter-warehouse transfer for materials** → skip (YAGNI). Add later mirroring
  `record_transfer` if needed.
- **Opname grid for materials** → skip. A single-material adjust form covers
  corrections; the full count grid can come later.
- **`supply_mode` flag (cmt/maklon) on production orders** → skip. Absence of an
  issue = maklon.

## Data Model

All new tables follow the existing pattern: `tenant_id` defaulted from
`auth.jwt() ->> 'tenant_id'`, RLS `tenant_isolation`, per-tenant unique keys.
Material quantities are **decimal** (`numeric(14,3)`) — meters, kg, rolls — unlike
integer SKU quantities.

### `material_ledger`
```
id           uuid pk
tenant_id    uuid not null → tenants
material_id  uuid not null → materials
location_id  uuid not null → locations
qty          numeric(14,3) not null         -- signed; sign set by the function
movement_type text not null check in ('purchase_in','issue_out','adjustment','transfer_in','transfer_out')
reason       text
ref_type     text
ref_id       uuid
created_by   uuid
created_at   timestamptz not null default now()
constraints: qty <> 0; adjustment requires non-empty reason
```
- Append-only: RLS `select` only; `record_material_movement()` is the sole writer
  (grants revoked on direct insert/update/delete), mirroring `stock_ledger`.

### `purchase_orders`
```
id, tenant_id, code text ('PB-XXXXXXXX'), vendor_id → vendors,
location_id → locations   -- receipt destination
order_date date default current_date,
status text check in ('open','received','canceled') default 'open',
notes text, created_at
unique (tenant_id, code)
```

### `purchase_lines`
```
id, tenant_id, po_id → purchase_orders (on delete cascade),
material_id → materials,
qty_ordered  numeric(14,3) check > 0,
unit_price   numeric(14,2) default 0 check >= 0,
qty_received numeric(14,3) default 0 check >= 0
```

### `bom_lines`
```
id, tenant_id, style_id → styles (on delete cascade),
material_id → materials,
qty_per_unit numeric(14,4) check > 0,
unique (tenant_id, style_id, material_id)
```
- BOM is edited via direct table writes under RLS (no function).

## Functions (all `security definer`, `search_path = public`)

### `record_material_movement(p_material_id, p_qty, p_movement_type, p_reason, p_ref_type, p_ref_id, p_location_id)`
Mirror of `record_movement`:
- tenant from JWT; validate material belongs to tenant; resolve `p_location_id`
  (null → tenant default location, else validate same tenant).
- Sign: `issue_out`/`transfer_out` → `-abs(qty)`; `adjustment` → `qty` as-is (with
  non-empty reason guard); else (`purchase_in`, `transfer_in`) → `+abs(qty)`.
- Insert into `material_ledger`. Returns the row id.

### `create_purchase_order(p_vendor_id, p_location_id, p_order_date, p_notes, p_lines jsonb)`
- `p_lines`: `[{material_id, qty_ordered, unit_price}]`.
- Validate vendor + all materials in tenant; `qty_ordered > 0`; at least one line.
- `p_location_id` null → tenant default. Generate `PB-` code. Insert PO (status
  `open`) + lines. Return PO id.

### `receive_purchase(p_po_id, p_receipts jsonb)`
- `p_receipts`: `[{line_id, qty}]` — partial quantities.
- Validate PO in tenant and not `canceled`; each line belongs to the PO; `qty > 0`;
  `qty_received + qty <= qty_ordered` (reject over-receipt).
- For each: `qty_received += qty`; `record_material_movement(material_id, qty,
  'purchase_in', null, 'purchase_line', line_id, po.location_id)`.
- If every line is fully received → set PO `status = 'received'`. Returns void.

### `issue_material_to_po(p_prod_po_id, p_issues jsonb, p_location_id)`
- `p_prod_po_id` is a **production order** id; `p_issues`: `[{material_id, qty}]`.
- Validate production order in tenant; materials in tenant; `qty > 0`; sufficient
  material balance at `p_location_id` (reject overdraw).
- `record_material_movement(material_id, qty, 'issue_out', 'issue to <po code>',
  'production_order', p_prod_po_id, p_location_id)`. Returns void.

## Views
- `material_balances_by_location` — `sum(qty)` by (material_id, location_id, tenant).
- `material_balances` — `sum(qty)` by (material_id, tenant). Both `security_invoker`.

## Pure Logic (vitest)
- `suggestIssue(bomLines: {material_id, qty_per_unit}[], totalUnits): {material_id, qty}[]`
  — suggested issue per material = `qty_per_unit * totalUnits`. `totalUnits` = sum
  of a production order's `prod_lines.qty_ordered`.

## UI
- **Stok Bahan** (`/material-stock`): per-location material balances
  (from `material_balances_by_location` joined to material + location names),
  recent movements, and a single-material adjust form (mirrors `AdjustForm`,
  decimal qty, reason required).
- **Pembelian** (`/purchasing`): list POs (code, vendor, status); create form
  (vendor, receipt location, order date, lines: material + qty + unit_price);
  PO detail with per-line partial-receive inputs.
- **BOM**: section on style detail (`/styles/[id]`) — list, add, remove
  `bom_lines` (material + qty_per_unit).
- **Issue Bahan**: section on production-order detail (`/production/[id]`) —
  BOM-suggested quantities (via `suggestIssue`), editable, submit → issue. Only
  meaningful for CMT orders; maklon orders skip it.
- Nav: a new **Pembelian** group with Pembelian + Stok Bahan.
- Vendors are reused as material suppliers (same `vendors` table).

## Error Handling
- `receive_purchase`: raise on over-receipt, canceled PO, cross-tenant line.
- `issue_material_to_po`: raise on insufficient balance, cross-tenant material/PO.
- `record_material_movement`: raise on cross-tenant material/location, zero qty,
  missing default location, adjustment without reason — mirroring `record_movement`.
- Material deletion blocked while ledger/PO/BOM rows reference it (FK restrict).

## Testing
- pgtap: `material_ledger` append-only + `record_material_movement` (sign per type,
  cross-tenant, default-location resolution, adjustment-reason); `receive_purchase`
  (partial receipt updates qty + writes `purchase_in`; over-receipt rejected; full
  receipt sets status `received`); `issue_material_to_po` (writes negative
  `issue_out`; insufficient-balance rejected); RLS isolation on `material_ledger`,
  `purchase_orders`, `purchase_lines`, `bom_lines`.
- vitest: `suggestIssue`.
- E2E: create PO → partial receive → material balance increases by received qty.

## Migration Order
1. `material_ledger` (+ append-only grants) and `record_material_movement`.
2. `material_balances` + `material_balances_by_location` views.
3. `purchase_orders` + `purchase_lines`.
4. `create_purchase_order` + `receive_purchase`.
5. `bom_lines`.
6. `issue_material_to_po`.

## Dependencies / Downstream
- Reuses Fase A `materials`, `locations`, and the `vendors` table.
- Fase C (AP) turns received purchase lines into vendor bills/payables.
- Deferred material valuation would later post material cost into `cost_entries`
  / finished-goods HPP at issue time.
