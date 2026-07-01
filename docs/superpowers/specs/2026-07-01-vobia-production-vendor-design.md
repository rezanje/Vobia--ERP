# Design — Vobia ERP Sub-project 4: Production & Vendor

**Status:** Approved (brainstorm) — owner will review the running app, flow adjustable after.
**Tanggal:** 2026-07-01
**Related:** `vobia_erp_phase1_prd.md` §4/§5.4, §8; `vobia_architecture_adr.md` §5/§6
**Depends on:** Foundation, Product Spine (`styles`,`skus`), Stock Ledger (`record_movement`).

## 1. Tujuan

Lacak batch produksi di vendor eksternal via state machine. Saat stage → `completed`, otomatis tulis `production_in` ke stock ledger per prod_line (qty_received) — menutup loop produksi → stok.

## 2. Keputusan (brainstorm)

- **State graph** (2-lapis: DB function raise + UI hanya tampilkan tombol legal):
  - `trial` → `mass_production` | `canceled`
  - `mass_production` → `qc` | `canceled`
  - `qc` → `completed` | `mass_production` (rework) | `canceled`
  - `completed`, `canceled` = terminal.
- **PO code auto-generate** (`PO-` + 8 hex), bukan manual.
- **qty_received** diisi manual per prod_line sebelum complete; `completed` hanya record prod_line dengan `qty_received > 0`.
- **Idempotent**: `completed` terminal → tak bisa complete 2x → stok tak dobel.

## 3. Data model (tenant_id + RLS template di semua tabel)

### 3.1 `vendors`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS |
| name | text not null | |
| contact | text | nullable |
| active | boolean not null default true | |
| created_at | timestamptz default now() | |

Unique `(tenant_id, name)`.

### 3.2 `production_orders`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS |
| code | text not null | auto `PO-xxxxxxxx` |
| style_id | uuid not null → styles(id) | |
| vendor_id | uuid not null → vendors(id) | |
| stage | text not null default `trial` | check in (`trial`,`mass_production`,`qc`,`completed`,`canceled`) |
| deadline | date | nullable |
| notes | text | nullable |
| created_at | timestamptz default now() | |

Unique `(tenant_id, code)`. Index `(tenant_id, stage)`.

### 3.3 `prod_lines`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS |
| po_id | uuid not null → production_orders(id) on delete cascade | |
| sku_id | uuid not null → skus(id) | |
| qty_ordered | integer not null | check > 0 |
| qty_received | integer not null default 0 | check >= 0 |
| reject_count | integer not null default 0 | check >= 0 |
| created_at | timestamptz default now() | |

Index `(po_id)`.

## 4. Logic — 2 RPC (SECURITY INVOKER, stamp tenant dari claim)

### 4.1 `create_production_order(p_style_id uuid, p_vendor_id uuid, p_deadline date, p_notes text, p_lines jsonb) returns uuid`
- `v_tenant := auth.jwt()->>'tenant_id'`; null → raise.
- Validasi `style.tenant_id = v_tenant` dan `vendor.tenant_id = v_tenant` (else raise).
- `p_lines` ≥ 1; tiap line `qty_ordered > 0`; `sku.tenant_id = v_tenant`.
- Auto code `PO-` || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)).
- Insert PO (stage `trial`) + prod_lines (qty_received 0, reject_count 0). Return po id.

### 4.2 `transition_production_stage(p_po_id uuid, p_next_stage text) returns void`
- Ambil PO (RLS → hanya tenant sendiri; not found → raise).
- Validasi transisi legal via CASE map (lihat §2). Ilegal → raise `illegal transition <from> -> <to>`.
- Jika `p_next_stage = 'completed'`: `for each prod_line where qty_received > 0` → `perform record_movement(sku_id, qty_received, 'production_in', null, 'production_line', prod_line.id)`.
- `update production_orders set stage = p_next_stage where id = p_po_id`.

`record_movement` (SECURITY DEFINER) menstamp tenant + validasi sku tenant sendiri — aman dipanggil dari sini.

Server actions (`src/lib/production/actions.ts`):
- `createVendor({name, contact})` → insert vendors (RLS-scoped).
- `createProductionOrder({style_id, vendor_id, deadline, notes, lines})` → rpc, redirect ke detail.
- `updateProdLine({id, qty_received, reject_count})` → update prod_lines, revalidate.
- `transitionStage({po_id, next_stage})` → rpc, revalidate.

## 5. UI (tema gelap)

- **`/vendors`** — list (name, contact, active) + form create.
- **`/production`** — list PO (code, style code, vendor, stage badge, deadline) + "New order".
- **`/production/new`** — pilih style + vendor + deadline + notes; tambah prod_lines (dropdown sku + qty_ordered).
- **`/production/[id]`** — detail: stage badge, tabel prod_lines (sku, qty_ordered, qty_received editable, reject_count editable → `updateProdLine`), tombol next-stage **legal saja** → `transitionStage`. Setelah `completed`, stok naik (cek `/stock`).
- Nav: tambah **Production**, **Vendors**.

## 6. Testing

- **pgTAP:**
  - `create_production_order`: tenant stamp, PO `trial`, N prod_lines, style/vendor tenant guard (cross-tenant → raise).
  - transisi legal (`trial→mass_production`) ok; ilegal (`trial→completed`) → raise.
  - `completed` → `production_in` per prod_line = qty_received; `stock_balances` naik sesuai; prod_line qty_received=0 tak menambah.
  - idempotency: PO sudah `completed` → transisi lagi → raise (terminal), stok tak berubah.
- **Playwright:** buat vendor → PO (style+sku, qty_ordered) → set qty_received di detail → transisi trial→mass_production→qc→completed → `/stock` balance = qty_received.

## 7. Files

- `supabase/migrations/…_production_vendor.sql` — 3 tabel + RLS + grants.
- `supabase/migrations/…_production_fns.sql` — 2 RPC.
- `supabase/tests/production.test.sql`.
- `src/types/database.ts` — + 3 tabel + 2 fungsi.
- `src/lib/production/actions.ts`.
- `src/app/(app)/vendors/{page,VendorForm}.tsx`.
- `src/app/(app)/production/{page,new,[id]}` (+ client bits: order form, prod-line editor, stage buttons).
- `e2e/production.spec.ts`.

## 8. Out of scope

- Material/BOM, raw-material PO (deferred di PRD).
- Vendor performance report (modul reporting nanti).
- Edit/hapus PO setelah dibuat (cuma stage transition + prod_line qty edit).
- sale_out/return_in (modul Order/Returns).
