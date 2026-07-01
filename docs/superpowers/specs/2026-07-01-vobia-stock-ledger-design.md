# Design — Vobia ERP Sub-project 3: Stock Ledger

**Status:** Approved (brainstorm)
**Tanggal:** 2026-07-01
**Related:** `vobia_erp_phase1_prd.md` §5.3, §8; `vobia_architecture_adr.md` §5
**Depends on:** Foundation (RLS, auth), Product Spine (`skus`).

## 1. Tujuan

Deep module: **satu-satunya jalur tulis ke stok**. Ledger append-only; balance = sum(qty) per SKU. Modul lain (production, order, returns) menulis stok cuma lewat `record_movement()`. Dibangun & ditest isolated karena semua modul lain depend ke sini.

## 2. Keputusan (brainstorm)

- **Enforcement:** DB-enforced. Revoke INSERT/UPDATE/DELETE `stock_ledger` dari `authenticated`; hanya `record_movement()` (SECURITY DEFINER) yang menulis. Append-only, tak bisa dibypass.
- **Adjustment audit:** movement_type `adjustment` wajib `reason`.
- **Negative balance:** diizinkan (ledger mencatat kebenaran; mismatch timing wajar). Di-UI ditandai warning; tidak diblok.
- **Scope:** ledger + `record_movement` + balances/history + UI read-only Stock + form adjustment manual. `production_in`/`sale_out`/`return_in` masuk dari modul lain nanti (bukan UI di sub-project ini).

## 3. Data model

### 3.1 `stock_ledger` (append-only)
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| tenant_id | uuid not null | RLS (select) |
| sku_id | uuid not null → skus(id) | |
| qty | integer not null | signed, ≠ 0 |
| movement_type | text not null | check: `production_in`/`sale_out`/`return_in`/`adjustment` |
| reason | text | wajib (not null) kalau `adjustment` — check constraint |
| ref_type | text | null; mis. `order_line`/`production_line`/`return` |
| ref_id | uuid | null; link ke sumber |
| created_by | uuid | null-able; `auth.uid()` |
| created_at | timestamptz not null default now() | |

Check: `qty <> 0`; `(movement_type <> 'adjustment') or (reason is not null and trim(reason) <> '')`.
Index: `(sku_id)`, `(tenant_id, created_at desc)`.

### 3.2 `stock_balances` (view, security_invoker)
```sql
create view public.stock_balances with (security_invoker = on) as
select sku_id, tenant_id, sum(qty)::int as balance
from public.stock_ledger
group by sku_id, tenant_id;
```

## 4. Single write path — `record_movement()`

`public.record_movement(p_sku_id uuid, p_qty int, p_movement_type text, p_reason text default null, p_ref_type text default null, p_ref_id uuid default null) returns uuid`, **SECURITY DEFINER**, `set search_path = public`.

Karena DEFINER bypass RLS, fungsi wajib menegakkan tenant sendiri:
- `v_tenant := (auth.jwt() ->> 'tenant_id')::uuid`; null → raise.
- Ambil `sku.tenant_id`; jika sku tak ada atau `<> v_tenant` → raise (cegah tulis ke sku tenant lain).
- Validasi `movement_type` ∈ himpunan; `p_qty <> 0`.
- **Sign normalization:** `production_in`/`return_in` → `+abs(p_qty)`; `sale_out` → `-abs(p_qty)`; `adjustment` → `p_qty` apa adanya (reason wajib, else raise).
- Insert ledger dengan `tenant_id = v_tenant`, `created_by = auth.uid()`. Return ledger id.

Grants:
- `revoke insert, update, delete on public.stock_ledger from authenticated;`
- `grant select on public.stock_ledger to authenticated;` (+ RLS tenant_isolation **for select**)
- `grant select on public.stock_balances to authenticated;`
- `grant execute on function public.record_movement(...) to authenticated;`

RLS: `stock_ledger` enable RLS + policy `tenant_isolation` **for select** (baca history scoped). Tak perlu insert policy (direct insert sudah di-revoke; definer fn bypass RLS).

## 5. UI (tema gelap)

- Route `(app)/stock`:
  - **Balances**: tabel `sku_code · balance` (badge merah kalau `balance < 0`). Baca `stock_balances` join `skus`.
  - **Adjustment form** (client): pilih SKU (dropdown dari skus), qty (signed int), reason → server action `recordAdjustment` → `record_movement(type='adjustment')`. Revalidate.
  - **Recent movements**: daftar 20 movement terakhir (sku, type, qty, reason, waktu).
- Nav shell: tambah **Stock**.

## 6. Server actions (`src/lib/stock/actions.ts`)

- `recordAdjustment({ sku_id, qty, reason })` → `supabase.rpc('record_movement', { p_sku_id, p_qty, p_movement_type: 'adjustment', p_reason: reason })`; return `{error}` atau revalidatePath('/stock').
- Reads (balances, movements, sku list) dilakukan inline di page server component.

## 7. Testing

- **pgTAP:**
  - `record_movement` insert → balance = sum, tenant + created_by ke-stamp.
  - **direct insert** ke `stock_ledger` sebagai `authenticated` → **permission denied**.
  - update/delete sebagai authenticated → denied (append-only).
  - cross-tenant: record_movement dengan sku tenant lain → raise.
  - `adjustment` tanpa reason → raise.
  - sign normalization: `sale_out` qty 10 → tersimpan `-10`; `production_in` → `+10`.
- **Playwright:** login → seed style+SKU (rpc) → `/stock` adjustment `+15` → balance `15` tampil; adjustment `-20` → balance `-5` + badge negatif.

## 8. Files

- `supabase/migrations/…_stock_ledger.sql` — tabel + RLS(select) + revokes + view + grants.
- `supabase/migrations/…_record_movement_fn.sql` — RPC.
- `supabase/tests/stock_ledger.test.sql` — pgTAP (write-path, isolation, append-only, sign).
- `src/types/database.ts` — + `stock_ledger`, `stock_balances`, `record_movement`.
- `src/lib/stock/actions.ts`.
- `src/app/(app)/stock/page.tsx`, `AdjustForm.tsx`.
- `e2e/stock-ledger.spec.ts`.

## 9. Out of scope

- UI untuk production_in/sale_out/return_in (datang dari modul Production/Order/Returns).
- Balance snapshot/caching (view real-time cukup untuk volume Phase 1).
- Multi-warehouse/location.
