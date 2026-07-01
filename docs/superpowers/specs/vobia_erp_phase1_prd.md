# PRD — Vobia ERP Phase 1

**Status:** Draft (reconstructed from ADR)
**Tanggal:** 2026-07-01
**Related:** `vobia_architecture_adr.md`
**Deciders:** GenDev Studio (Nje) × Vobia

> Catatan: dokumen ini direkonstruksi dari ADR §5 (modul→entity) dan §8 (urutan build), karena file PRD asli yang dirujuk ADR belum ada di repo. Ini bukan PRD "Operations Control Tower" (2026-06-16) — itu produk monitoring yang berbeda. Ini PRD untuk **custom ERP / system of record**.

---

## 1. Tujuan

Bangun ERP custom yang jadi **system of record** untuk operasi fashion Vobia: product spine, stok, produksi vendor, order omnichannel, returns, dan costing (HPP). Dirancang **multi-tenant sejak entity pertama** supaya bisa diproduktisasi ke brand fashion lain (Vobia = client zero).

Beda dengan monitoring tower: ERP ini **memiliki** data (menulis ledger, hitung HPP, jalankan state machine), bukan cuma membaca export dari Jubelio/Accurate.

## 2. Prinsip desain

- **Multi-tenant via RLS di database**, bukan filter di application code. `tenant_id` di semua tabel.
- **Stock ledger = satu-satunya write path ke stok.** Semua perubahan stok = insert ledger. Balance = view turunan, bukan kolom yang di-update manual.
- **State machine divalidasi 2 lapis:** DB constraint/function + Server Action guard.
- **Types digenerate dari schema** (Supabase codegen), no manual drift.
- **YAGNI:** tunda ORM, queue dedicated, marketplace sync sampai benar-benar dibutuhkan (lihat ADR §7).

## 3. Stack (dengan koreksi currency)

Ikuti ADR §3, dengan 3 koreksi:

1. **Next.js:** ADR tulis "14+". Mulai fresh di **Next.js 15/16** (App Router, Turbopack default), bukan 14.
2. **RLS helper:** pakai `auth.jwt() ->> 'tenant_id'` (helper Supabase saat ini), bukan `current_setting('request.jwt.claims')::json->>...` mentah. Fungsional sama, lebih bersih.
3. **Custom claim:** `tenant_id` masuk JWT lewat **Supabase custom access token auth hook** — ini setup eksplisit, bukan otomatis. Wajib dipasang di Foundation sebelum RLS berguna.

## 4. Entitas (14)

| Modul | Tabel | Field kunci |
|---|---|---|
| **Foundation** | `tenants` | id, name, created_at |
| | `profiles` | id (=auth.users.id), tenant_id, role (`owner`/`ops`/`production`/`inventory`/`finance`/`viewer`), full_name |
| **Product Spine** | `styles` | id, tenant_id, code, name, collection, status |
| | `colorways` | id, tenant_id, style_id, color_name, color_code |
| | `skus` | id, tenant_id, colorway_id, sku_code, size, size_curve (jsonb di style/colorway saat create), active |
| **Stock Ledger** | `stock_ledger` | id, tenant_id, sku_id, qty (signed), movement_type (`production_in`/`sale_out`/`return_in`/`adjustment`), ref_type, ref_id, created_at |
| | `stock_balances` (view) | sku_id, tenant_id, balance (sum qty) |
| **Production & Vendor** | `vendors` | id, tenant_id, name, contact, active |
| | `production_orders` | id, tenant_id, style_id, vendor_id, stage (`trial`/`mass_production`/`qc`/`completed`/`canceled`), deadline, notes |
| | `prod_lines` | id, tenant_id, po_id, sku_id, qty_ordered, qty_received, reject_count |
| **Channel & Order** | `channels` | id, tenant_id, name, type (`marketplace`/`web`/`offline`) |
| | `orders` | id, tenant_id, channel_id, external_ref, order_date, status |
| | `order_lines` | id, tenant_id, order_id, sku_id, qty, unit_price |
| **Returns** | `returns` | id, tenant_id, order_line_id, qty, reason, restock (bool) |
| **Costing** | `cost_entries` | id, tenant_id, po_id, cost_type, amount, qty_basis; PPV = generated column |

**Deferred (bukan Phase 1):** materials/BOM, raw-material purchase orders. `cost_entries` + `production_orders` menutup kebutuhan costing & vendor CMT untuk sekarang.

## 5. Kebutuhan fungsional per modul

### 5.1 Foundation (P0)
- Provision Supabase, repo Next.js (App Router, TS, Tailwind), pipeline codegen types.
- `tenants` + `profiles` + RLS policy pattern (`tenant_id = auth.jwt() ->> 'tenant_id'`) dipasang **sebelum** entity lain.
- Custom access token auth hook inject `tenant_id` + `role` ke JWT saat login.
- Signup/login flow; user baru → profile dengan tenant_id.

### 5.2 Product Spine (P0)
- Server Action `createSku`: validasi size_curve, expand size_curve → rows SKU saat create.
- CRUD styles → colorways → skus. Filter by collection/status.

### 5.3 Stock Ledger (P0, deep module)
- `recordMovement(sku_id, qty, movement_type, ref)` — satu-satunya write path.
- `getBalance(sku_id)` baca dari view `stock_balances`.
- Test isolated dulu — semua modul lain depend ke sini.

### 5.4 Production & Vendor (P0)
- `transitionStage(po_id, next_stage)` — validasi transisi di DB function + Server Action guard.
- Stage → `completed`: auto-insert `production_in` ke `stock_ledger` per prod_line (qty_received).
- Vendor CRUD; reject_count per prod_line.

### 5.5 Channel & Order (P0 entry manual)
- CRUD channels; entry order manual / CSV import.
- Order line `sale_out` → insert ledger (kurangi stok).
- Sync adapter marketplace = Route Handler **stub** (Phase 2).

### 5.6 Returns (P1)
- Trigger Postgres: `restock=true` → auto-insert `return_in` ke `stock_ledger`.

### 5.7 Costing (P1)
- `recalculateSkuHpp()` dipanggil dari Edge Function saat ada `cost_entry` baru.
- PPV = generated column, tidak dihitung di aplikasi.

## 6. Non-fungsional

- RLS: bug di app code tidak boleh bisa bocorin data antar tenant. Verifikasi via pgTAP.
- Type safety end-to-end (generated types).
- Testing: Vitest (logic murni), Playwright (flow kritis), pgTAP (RLS/constraint).
- Zero-ops MVP di Vercel + Supabase Cloud; schema portable (Postgres standar) untuk opsi self-host nanti.

## 7. Acceptance criteria Phase 1

- Login dua tenant beda → masing-masing hanya lihat datanya (RLS enforced, dibuktikan pgTAP).
- `createSku` expand size_curve dengan benar; SKU code unik per tenant.
- `recordMovement` satu-satunya jalan ubah stok; `stock_balances` = sum ledger.
- `transitionStage` tolak transisi ilegal (mis. `trial`→`completed` langsung) di DB + app.
- PO → `completed` auto-insert `production_in`; balance naik sesuai qty_received.
- Order line → `sale_out` kurangi balance.
- Return `restock=true` → `return_in` naikkan balance; `restock=false` → tidak.
- `cost_entry` baru → HPP ter-recalc; PPV generated benar.

## 8. Decomposition & urutan build (dari ADR §8)

Tiap sub-project = spec → plan → implement sendiri.

1. **Foundation** — repo + Supabase + tenant/RLS + auth hook. ← **spec pertama**
2. **Product Spine** — styles → colorways → skus + size_curve.
3. **Stock Ledger** — deep module, build & test isolated.
4. **Production & Vendor** — state machine + auto-ledger on completed.
5. **Costing** — cost_entries + recalc HPP + PPV.
6. **Channel & Order** — entry manual, sync stub.
7. **Returns** — trigger restock.
8. **UI dashboard** — paralel begitu 2–3 modul stabil. Salvage design system dari prototype lama (styles.css + pola visual), rebuild screens.

## 9. Open questions

- Threshold/aturan bisnis costing (metode HPP: moving average? standard?).
- Order status lifecycle detail (draft→paid→fulfilled→...?).
- Size curve format persis (S/M/L/XL qty map?).
