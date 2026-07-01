# Design — Vobia ERP Sub-project 2: Product Spine

**Status:** Approved (brainstorm)
**Tanggal:** 2026-07-01
**Related:** `vobia_erp_phase1_prd.md` §4/§5.2, §8; `vobia_architecture_adr.md` §5
**Depends on:** Foundation (sub-project 1) — RLS template, Supabase clients, auth.

## 1. Tujuan

Catalog structure Vobia: `styles → colorways → skus`. Bikin satu style + colorway + daftar size, auto-expand jadi SKU (colorway × size). System of record buat produk; modul lain (stock ledger, production, costing) refer ke `skus`.

Non-goal: product dev lifecycle state machine (Idea→Sampling→…) — itu produk monitoring lama, bukan ERP spine. Status style di sini minimal.

## 2. Keputusan (dari brainstorm)

- **size_curve = list size** (mis. `["S","M","L","XL"]`), input transien pas create → expand ke baris `skus`. **Tidak** disimpan sebagai kolom jsonb (ponytail: sizes yang ada = `distinct skus.size`; tambah kolom kalau nanti butuh intended-curve terpisah).
- **sku_code auto + override**: default `{style.code}-{colorway.color_code}-{size}`, boleh diedit.
- **Scope penuh dengan UI** pakai design system gelap yang diselamatkan dari prototype.
- **Layout create = single-page** (fields + colorways + size chips + live SKU preview).

## 3. Data model

Semua tabel bawa `tenant_id` + RLS template Foundation. tenant_id di-denormalisasi ke colorways & skus (RLS langsung, bukan andalin join).

### 3.1 `styles`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| tenant_id | uuid not null | RLS |
| code | text not null | mis. `VB-MIRA` |
| name | text not null | |
| collection | text | nullable |
| created_at | timestamptz default now() | |

Unique: `(tenant_id, code)`.

### 3.2 `colorways`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS |
| style_id | uuid not null → styles(id) on delete cascade | |
| color_name | text not null | mis. `Black` |
| color_code | text not null | mis. `BLK` |
| created_at | timestamptz default now() | |

Unique: `(tenant_id, style_id, color_code)`. Index `(style_id)`.

### 3.3 `skus`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS |
| colorway_id | uuid not null → colorways(id) on delete cascade | |
| size | text not null | mis. `M` |
| sku_code | text not null | auto/override |
| active | boolean not null default true | |
| created_at | timestamptz default now() | |

Unique: `(tenant_id, sku_code)` dan `(tenant_id, colorway_id, size)`. Index `(colorway_id)`.

## 4. Logic — atomic expand via Postgres RPC

Fungsi `public.create_style_with_skus(...)`, **SECURITY INVOKER**, jalan sebagai user authenticated, baca `auth.jwt() ->> 'tenant_id'` untuk stamp tenant_id. Semua insert dalam 1 transaksi (atomic — gak ada style yatim kalau sebagian gagal).

Signature:
```
create_style_with_skus(
  p_code text, p_name text, p_collection text,
  p_colorways jsonb,   -- [{"color_name":"Black","color_code":"BLK"}, ...]
  p_sizes text[],      -- ['S','M','L']
  p_overrides jsonb    -- {"BLK-S":"CUSTOM-CODE", ...} keyed by color_code-size; boleh {}
) returns uuid          -- style id
```
Perilaku:
- Validasi: `p_code`/`p_name` non-empty, `p_colorways` ≥ 1, `p_sizes` ≥ 1.
- Insert style (tenant_id dari claim). Untuk tiap colorway insert row, lalu untuk tiap size insert sku: `sku_code = coalesce(override[color_code||'-'||size], p_code||'-'||color_code||'-'||size)`.
- RLS `with check (tenant_id = auth.jwt()->>'tenant_id')` lolos karena tenant_id di-stamp dari claim yang sama.
- Unique violation (kode dobel) → exception → seluruh transaksi rollback → Server Action tangkap, tampilkan error.

Server Actions (`src/lib/products/actions.ts`):
- `createStyle(formData)` → panggil `.rpc('create_style_with_skus', ...)`, redirect ke `/styles/[id]` atau balik dengan error.
- `listStyles()` → styles + count colorways & skus (view atau select agregat).
- `getStyle(id)` → style + colorways + skus.
- `toggleSku(id, active)` → update skus.active.

Helper murni (`src/lib/products/skuCode.ts`): `buildSkuCode(styleCode, colorCode, size)` + `mergeOverride(auto, overrides, key)`. Dipakai UI (live preview) & dikirim ke rpc. Ditest Vitest.

## 5. UI — dark design system, single-page

- **Theme:** ekstrak token gelap + komponen kunci dari `_legacy-prototype/src/styles.css` ke `src/app/globals.css` (atau `src/app/vobia-theme.css`). Accent `#d7ff61`, surface `#16211b`/`#0f1b15`, text `#e8f0e8`, muted `#8fa89a`.
- **Route group `(app)`** dengan layout bernav (sidebar: Dashboard, Styles).
- **`/styles`** — list: code, name, collection, #colorways, #skus, link detail. Empty state "Create your first style".
- **`/styles/new`** — single-page form (client component untuk live preview):
  - Fields: code, name, collection.
  - Colorways: rows (color_name, color_code) + add/remove.
  - Sizes: chips toggle (S/M/L/XL + custom).
  - **Live SKU preview grid**: colorway × size, kode auto (client-side `buildSkuCode`), tiap kode editable (override).
  - Submit → `createStyle` server action → rpc.
- **`/styles/[id]`** — detail: info style, colorways, tabel SKU (size, code, active toggle).

## 6. RLS

Template Foundation persis di 3 tabel:
```sql
alter table public.styles enable row level security;
create policy tenant_isolation on public.styles
  for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.styles to authenticated;
```
(idem colorways, skus). App role dibaca dari `user_role` claim kalau perlu gating nanti — bukan `role` (lihat Foundation spec gotcha).

## 7. Testing

- **pgTAP:**
  - Isolasi 3 tabel (pola sama Foundation rls.test): tenant A gak liat data tenant B.
  - `create_style_with_skus`: set claim tenant, panggil dengan 2 colorway × 3 size → assert 1 style, 2 colorways, 6 skus, kode benar, semua tenant_id = claim. Test override. Test unique violation → rollback (0 rows tertinggal).
- **Vitest:** `buildSkuCode` + `mergeOverride` (edge: size kosong, override sebagian).
- **Playwright:** login (admin-seeded confirmed user, pola Foundation e2e) → `/styles/new` → isi style + 2 colorway + 3 size → save → `/styles/[id]` tampil 6 SKU. Second-tenant isolation via rpc/query.

## 8. Files / units

- `supabase/migrations/…_product_spine.sql` — 3 tabel + RLS + grants.
- `supabase/migrations/…_create_style_fn.sql` — rpc `create_style_with_skus`.
- `supabase/tests/product_spine_rls.test.sql`, `create_style.test.sql`.
- `src/types/database.ts` — tambah 3 tabel + fungsi (hand-written sampai codegen bisa).
- `src/lib/products/skuCode.ts` (+ `skuCode.test.ts` Vitest).
- `src/lib/products/actions.ts` — server actions.
- `src/app/(app)/layout.tsx` — nav shell.
- `src/app/(app)/styles/page.tsx`, `styles/new/page.tsx` (+ client form komponen), `styles/[id]/page.tsx`.
- theme di `src/app/globals.css`.
- `e2e/product-spine.spec.ts`.

## 9. Out of scope

- Edit/hapus style/colorway (cuma create + toggle sku active dulu).
- Bulk import CSV.
- Intended size_curve terpisah dari SKU.
- Product dev lifecycle status.
