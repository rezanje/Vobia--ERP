# Design — Vobia ERP Sub-project 5: Costing (HPP)

**Status:** Approved (brainstorm, ponytail-trimmed) — owner reviews the running app; flow adjustable.
**Tanggal:** 2026-07-01
**Related:** `vobia_erp_phase1_prd.md` §5.6, §8; `vobia_architecture_adr.md` §5.
**Depends on:** Production & Vendor (`production_orders`, `prod_lines`), Stock Ledger.

## 1. Tujuan

Hitung HPP (harga pokok produksi) per SKU dari biaya produksi. Biaya nempel ke production order; HPP = weighted-average biaya aktual per unit yang diproduksi.

## 2. Keputusan (brainstorm + ponytail)

- **HPP = weighted-average aktual.** Per PO: `per_unit = sum(cost_entries.amount) / sum(prod_lines.qty_received)`. HPP SKU = `sum(per_unit × qty_received) / sum(qty_received)` across PO.
- **Live view `sku_hpp`** (seperti `stock_balances`) — recompute saat dibaca. **Bukan** Edge Function / stored recalc / generated column (deviasi sengaja dari ADR §5; revisit kalau volume gede).
- **Tanpa RPC** untuk insert biaya. Direct insert `cost_entries` dengan `tenant_id default claim` (pola `vendors`). RPC di-skip: satu-satunya risiko = nempel biaya ke PO tenant lain, butuh tebak UUID v4 (PO gak listable cross-tenant via RLS). `ponytail:` comment tandai residual + upgrade path (trigger validasi kalau jadi vektor nyata).
- **cost_type** cuma buat breakdown owner — **tidak** dipakai di kalkulasi HPP (HPP jumlahkan semua amount).

## 3. Data model

### 3.1 `cost_entries`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| tenant_id | uuid not null default (auth.jwt() ->> 'tenant_id')::uuid | RLS |
| po_id | uuid not null → production_orders(id) on delete cascade | |
| cost_type | text not null | check in (`material`,`cmt`,`overhead`,`other`) |
| amount | numeric(14,2) not null | check > 0 |
| note | text | nullable |
| created_at | timestamptz default now() | |

Index `(po_id)`. RLS template `tenant_isolation` (for all) + grants authenticated.

### 3.2 `sku_hpp` view (security_invoker)
```sql
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
       sum(qty_received) as costed_units
from line_alloc
group by tenant_id, sku_id;
```
`nullif(units,0)` cegah divide-by-zero (PO tanpa qty_received → per_unit null → sku gak muncul sampai ada unit).

## 4. Logic

Server actions (`src/lib/costing/actions.ts`):
- `addCostEntry({ po_id, cost_type, amount, note })` → `supabase.from('cost_entries').insert({ po_id, cost_type, amount, note })` (tenant_id auto default). revalidate `/production/[po]` + `/costing`.
- Reads: `sku_hpp` view + `cost_entries` per PO — inline di page.

## 5. UI (tema gelap)

- **`/production/[id]`** (modify): section **Costs** — list cost_entries (type, amount, note) + total + form add (cost_type select, amount, note) → `addCostEntry`.
- **`/costing`** (new) — tabel `sku_hpp`: sku_code, HPP (Rp), costed_units. Empty state "No costed SKUs yet".
- Nav: tambah **Costing**.

## 6. Testing

- **pgTAP:**
  - RLS isolasi `cost_entries` (tenant A gak liat B).
  - `sku_hpp` weighted-avg: seed 1 sku, PO1 qty_received 100 + cost 5000 → complete; assert hpp = 50. PO2 sama sku qty 100 + cost 6000 → assert hpp = (5000+6000)/200 = 55, costed_units = 200.
- **Playwright:** style→vendor→PO→received→completed→`/production/[id]` add cost 5000→`/costing` HPP muncul.

## 7. Files

- `supabase/migrations/…_cost_entries.sql` — tabel + RLS + grants + `sku_hpp` view.
- `supabase/tests/costing.test.sql`.
- `src/types/database.ts` — + `cost_entries` + `sku_hpp`.
- `src/lib/costing/actions.ts`.
- `src/app/(app)/costing/page.tsx`.
- `src/app/(app)/production/[id]/` — Costs section + `CostForm.tsx`.
- `e2e/costing.spec.ts`.

## 8. Out of scope

- Cost breakdown report per type (bisa dari cost_entries nanti).
- Standard costing / variance.
- Overhead allocation rules (flat entry dulu).
- Material/BOM.
