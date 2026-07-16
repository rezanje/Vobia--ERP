# Manufacturing Upstream (P1–P3): Forecast → PPIC → Procurement FOB/CMT

**Date:** 2026-07-16
**Goal:** Demo-walkable besok — klien bisa klik alur penuh Forecast → Projection → PCB → PPO → PO (FOB & CMT) → nyambung ke produksi/WMS yang sudah ada.
**Depth:** Demo-walkable (opsi A) — UI + skema DB + fungsi inti + seed data nyambung. Bukan production-hardened.

## Konteks

Sistem existing mulai dari PO/produksi ke hilir (produksi trial→mass→qc, stock ledger/WMS, orders/returns/channels, GL auto-journal, HR/payroll, costing per-style). Hasil wawancara klien: kebutuhan inti sebenarnya adalah SOP manufaktur make-to-plan (dokumen "vobia flow.md") — hulu P1–P3 belum ada sama sekali. Finance + HR tetap dipakai.

Alur target:

```
P1 FORECAST/PROJECTION → P2 PPIC → P3 PROCUREMENT → [udah ada]
  forecast sales           PCB       PPO (induk)      produksi (trial→mass→qc)
  forecast ops        (kuartalan)   ├ FOB → 1 PO      stock/WMS
  alignment→LOCK      supply calc   └ CMT → PO anak   orders/returns
  =Projection                          (mtrl/jahit/
  (regular+seasonal)                    bordir/akss)
```

Prinsip: tiap fase = modul terpisah, nyambung lewat 1 tabel output (projection → pcb → ppo → po). Bisa dites sendiri-sendiri.

## Data model baru

| Fase | Tabel baru | Isi inti |
|---|---|---|
| P1 | `forecasts` + `forecast_lines` | type sales/ops, period, qty per style |
| P1 | `projections` + `projection_lines` | status draft/locked, qty_final, kind regular/seasonal_new |
| P1 | `new_products` | R&D + marketing "cek ombak", agreed_qty → naik ke projection |
| P2 | `pcb` + `pcb_lines` | kuartalan, qty dari projection × cost dari costing |
| P2 | `ppo` | scheme fob/cmt, style, qty, link ke pcb |
| P3 | extend `purchase_orders` | + `ppo_id`, + `po_type` (finished/material/sewing/bordir/accessory) |
| P3 | `po_payments` | kind dp/settlement/full, status pending/paid |

Semua tabel baru: multi-tenant (tenant_id + RLS tenant_isolation), pola sama dengan migrasi existing.

Formula supply (sesuai SOP klien): `Total Beli = Ending Stock + Target Sales`. Target sales dari projection, ending stock dari stock ledger existing.

## Checklist fitur — "kalau sempurna" vs status

### P1 — Forecast → Projection

| Fitur (kalau sempurna) | Status |
|---|---|
| Forecast Sales (input qty per style, per periode) | 🔨 malam ini |
| Forecast Ops (qty + rekomendasi KPI: ITO, stock ratio) | 🔨 malam ini (KPI angka manual/simpel) |
| Alignment — banding sales vs ops side-by-side, set qty sepakat | 🔨 malam ini |
| Lock → Projection (immutable) | 🔨 malam ini |
| Produk seasonal-new: R&D design + Marketing cek ombak → agreed qty | 🔨 malam ini (status field, bukan workflow penuh) |
| KPI auto-hitung dari data real (ITO, stock ratio) | ⏳ nanti |
| Negosiasi/versioning history forecast | ⏳ nanti |

### P2 — PPIC

| Fitur | Status |
|---|---|
| Supply calc `EndingStock + TargetSales` per style | 🔨 malam ini |
| PCB kuartalan (qty dari projection × cost dari costing) | 🔨 malam ini |
| PPO induk (pilih scheme FOB/CMT) | 🔨 malam ini |
| Budget/expenditure roll-up kuartalan | 🔨 malam ini (tampil) |
| PCB akurat penuh + approval | ⏳ nanti |

### P3 — Procurement FOB/CMT

| Fitur | Status |
|---|---|
| FOB: PPO → 1 PO (finished) | 🔨 malam ini |
| CMT: PPO → pecah PO anak (material/jahit/bordir/aksesoris) | 🔨 malam ini |
| PO anak nyambung ke vendor masing-masing | 🔨 malam ini (vendor udah ada) |
| Pembayaran DP → settlement (FOB), bayar terpisah tiap vendor (CMT) | 🔨 malam ini (status pending/paid) |
| Pembayaran ke-post ke GL (kas/AP) | ⏳ nanti |
| Approval gate per PO | ⏳ nanti (gate udah ada di PO existing, tinggal colok) |

### Udah ada (nyambung, tidak dibangun ulang)

- ✅ Produksi trial→mass→qc (`production_orders`)
- ✅ Stock ledger + locations + WMS
- ✅ Orders/returns/channels (outbound)
- ✅ GL + auto-journal
- ✅ HR/payroll
- ✅ Costing per-style
- ✅ Doc approval gate

## Alur demo (yang klien klik besok)

`Input forecast sales+ops → alignment → LOCK projection → generate PCB kuartalan → bikin PPO (pilih FOB/CMT) → FOB: 1 PO / CMT: pecah 4 PO anak → set pembayaran → PO nyambung ke produksi & material issue existing`

Seed data: 1 style regular + 1 seasonal-new, alur penuh terisi.

## Keputusan desain

- **CMT split:** `purchase_orders` existing di-extend (`ppo_id`, `po_type`), bukan tabel PO baru — biar receive/material flow existing tetap jalan tanpa duplikasi.
- **Pembayaran:** `po_payments` status pending/paid saja untuk demo; posting GL menyusul (auto-journal engine sudah ada, tinggal ditambah rule).
- **Immutable projection:** lock = status flag + guard di fungsi (tolak edit kalau locked), bukan mekanisme DB khusus.
- **KPI ops (ITO, stock ratio):** field angka manual dulu; auto-hitung dari ledger menyusul.
- **Error handling:** fungsi DB (security definer, pola existing) validasi status transitions; UI tampilkan error apa adanya.
- **Testing:** verifikasi via alur demo end-to-end di dev server (port 3100) + seed; bukan unit test suite penuh malam ini.
