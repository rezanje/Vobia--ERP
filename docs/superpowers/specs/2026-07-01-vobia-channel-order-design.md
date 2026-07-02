# Design — Vobia ERP Sub-project 6: Channel & Order

**Status:** Approved (brainstorm) — owner reviews the running app; flow adjustable.
**Tanggal:** 2026-07-01
**Related:** `vobia_erp_phase1_prd.md` §5.5, §8; `vobia_architecture_adr.md` §5.
**Depends on:** Foundation, Product Spine (`skus`), Stock Ledger (`record_movement`).

## 1. Tujuan

Order jual per sales channel. Membuat order langsung menulis `sale_out` ke stock ledger per order_line — menutup loop keluar stok (mirror Production yang menulis `production_in`).

## 2. Keputusan (brainstorm)

- **Create order = sale_out langsung.** Tidak ada state machine order di Phase 1. Cancel/retur ditangani modul Returns (sub-project 7).
- **Oversell diizinkan** — balance boleh negatif (konsisten dengan Stock Ledger). Tidak diblok.
- **`unit_price` ditangkap** pas order (data revenue untuk reporting nanti); order total = sum(qty × unit_price).
- **`channels` direct insert** (tenant_id default claim, pola `vendors`/`cost_entries`); order lewat RPC.

## 3. Data model (tenant_id + RLS template di semua tabel)

### 3.1 `channels`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| tenant_id | uuid not null default (auth.jwt() ->> 'tenant_id')::uuid | RLS |
| name | text not null | mis. Shopee, TikTok, Offline |
| active | boolean not null default true | |
| created_at | timestamptz default now() | |

Unique `(tenant_id, name)`.

### 3.2 `orders`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS |
| code | text not null | auto `ORD-xxxxxxxx` |
| channel_id | uuid not null → channels(id) | |
| order_date | date not null default current_date | |
| customer | text | nullable |
| notes | text | nullable |
| created_at | timestamptz default now() | |

Unique `(tenant_id, code)`. Index `(tenant_id, order_date desc)`.

### 3.3 `order_lines`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS |
| order_id | uuid not null → orders(id) on delete cascade | |
| sku_id | uuid not null → skus(id) | |
| qty | integer not null | check > 0 |
| unit_price | numeric(14,2) not null default 0 | check >= 0 |
| created_at | timestamptz default now() | |

Index `(order_id)`.

## 4. Logic — `create_order` RPC (SECURITY INVOKER)

`create_order(p_channel_id uuid, p_order_date date, p_customer text, p_notes text, p_lines jsonb) returns uuid`, stamp tenant dari claim.
- `v_tenant` null → raise.
- Validasi `channel.tenant_id = v_tenant` (else raise); `p_lines` ≥ 1; tiap line `qty > 0` dan `sku.tenant_id = v_tenant` (else raise).
- Auto code `ORD-` || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)).
- Insert order (order_date coalesce current_date) + order_lines (unit_price coalesce 0).
- Per line → `perform record_movement(sku_id, qty, 'sale_out', null, 'order_line', line.id)` (normalize ke negatif).
- Return order id. Atomic (partial gagal → rollback).

`channels` insert direct via server action (tenant_id default).

Server actions (`src/lib/orders/actions.ts`):
- `createChannel({ name })` → insert channels. revalidate `/channels`.
- `createOrder({ channel_id, order_date, customer, notes, lines })` → rpc, redirect ke `/orders/[id]`.

## 5. UI (tema gelap)

- **`/channels`** — list (name, active) + form create.
- **`/orders`** — list orders (code, channel, date, total) + "New order".
- **`/orders/new`** — channel select + order_date + customer + lines (sku dropdown + qty + unit_price). Create → sale_out.
- **`/orders/[id]`** — detail read-only: header + lines (sku, qty, unit_price, subtotal) + total.
- Nav: **Orders**, **Channels**.

## 6. Testing

- **pgTAP:**
  - `create_order`: tenant stamp, N lines, channel/sku cross-tenant → raise.
  - sale_out per line: seed sku, `record_movement(+100)`; order qty 30 → `stock_balances` = 70; order qty 100 → -30 (oversell allowed).
  - RLS isolasi `orders`/`channels`.
- **Playwright:** style → `/stock` adjustment +100 → `/channels` add channel → `/orders/new` order qty 30 → `/stock` balance 70.

## 7. Files

- `supabase/migrations/…_channel_order.sql` — 3 tabel + RLS + grants.
- `supabase/migrations/…_order_fn.sql` — `create_order` RPC.
- `supabase/tests/orders.test.sql`.
- `src/types/database.ts` — + 3 tabel + fungsi.
- `src/lib/orders/actions.ts`.
- `src/app/(app)/channels/{page,ChannelForm}.tsx`.
- `src/app/(app)/orders/{page,new,[id]}` (+ client order form).
- `e2e/orders.spec.ts`.

## 8. Out of scope

- Order state machine (draft/confirm/ship) — create = sale_out sekarang.
- Cancel/retur → modul Returns (sub-project 7).
- Revenue/margin reporting (butuh HPP × qty − revenue; modul reporting nanti).
- Channel API import (manual entry dulu).
