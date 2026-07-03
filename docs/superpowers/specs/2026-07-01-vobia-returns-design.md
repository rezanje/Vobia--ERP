# Design — Vobia ERP Sub-project 7: Returns

**Status:** Approved (brainstorm) — owner reviews the running app; flow adjustable.
**Tanggal:** 2026-07-01
**Related:** `vobia_erp_phase1_prd.md` §5.5, §8; `vobia_architecture_adr.md` §5.
**Depends on:** Foundation, Product Spine (`skus`), Stock Ledger (`record_movement`), Channel & Order (`orders`).

## 1. Tujuan

Retur terhadap order jual. Membuat return langsung menulis `return_in` ke stock ledger per line (restock) — menutup sisi retur. Modul terakhir Phase 1.

## 2. Keputusan (brainstorm)

- **Return wajib link ke order** (`order_id` required) — traceability retur ↔ penjualan.
- **Tanpa validasi qty ≤ ordered** — catat kebenaran, owner rekonsiliasi (`ponytail:` comment + upgrade path).
- **Returned = restocked** (`return_in`, positif). Barang rusak / non-restock ditangani modul lanjutan.
- Entry line manual (sku + qty); tidak auto-populate dari order (YAGNI).

## 3. Data model (tenant_id + RLS template)

### 3.1 `returns`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| tenant_id | uuid not null default (auth.jwt() ->> 'tenant_id')::uuid | RLS |
| code | text not null | auto `RET-xxxxxxxx` |
| order_id | uuid not null → orders(id) | sale yang diretur |
| return_date | date not null default current_date | |
| reason | text | nullable |
| notes | text | nullable |
| created_at | timestamptz default now() | |

Unique `(tenant_id, code)`. Index `(tenant_id, return_date desc)`.

### 3.2 `return_lines`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS |
| return_id | uuid not null → returns(id) on delete cascade | |
| sku_id | uuid not null → skus(id) | |
| qty | integer not null | check > 0 |
| created_at | timestamptz default now() | |

Index `(return_id)`.

## 4. Logic — `create_return` RPC (SECURITY INVOKER)

`create_return(p_order_id uuid, p_return_date date, p_reason text, p_notes text, p_lines jsonb) returns uuid`, stamp tenant dari claim.
- `v_tenant` null → raise.
- Validasi `order.tenant_id = v_tenant` (else raise); `p_lines` ≥ 1; tiap line `qty > 0` dan `sku.tenant_id = v_tenant` (else raise).
- Auto code `RET-` || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)).
- Insert return + return_lines.
- Per line → `perform record_movement(sku_id, qty, 'return_in', null, 'return_line', line.id)` (restock positif).
- Return id. Atomic.

Server actions (`src/lib/returns/actions.ts`):
- `createReturn({ order_id, return_date, reason, notes, lines })` → rpc, redirect `/returns/[id]`.

## 5. UI (tema gelap)

- **`/returns`** — list (code, order code, date) + "New return".
- **`/returns/new`** — order select + return_date + reason + lines (sku dropdown + qty). Create → return_in.
- **`/returns/[id]`** — detail read-only: header (order code, date, reason) + lines (sku, qty).
- Nav: **Returns**.

## 6. Testing

- **pgTAP:**
  - `create_return`: tenant stamp, N lines, order/sku cross-tenant → raise.
  - return_in restock: seed sku, `record_movement(+100)`, order sale_out 30 → balance 70; return 10 → balance 80.
  - RLS isolasi `returns`.
- **Playwright:** style → `/stock` adjustment +100 → channel → order 30 (stok 70) → return 10 → `/stock` balance 80.

## 7. Files

- `supabase/migrations/…_returns.sql` — 2 tabel + RLS + grants.
- `supabase/migrations/…_return_fn.sql` — `create_return` RPC.
- `supabase/tests/returns.test.sql`.
- `src/types/database.ts` — + 2 tabel + fungsi.
- `src/lib/returns/actions.ts`.
- `src/app/(app)/returns/{page,new,[id]}` (+ client return form).
- `e2e/returns.spec.ts`.

## 8. Out of scope

- Validasi qty retur ≤ qty order.
- Barang rusak / non-restock (semua retur restock dulu).
- Refund / pengembalian dana (finance).
- Auto-populate line dari order.
