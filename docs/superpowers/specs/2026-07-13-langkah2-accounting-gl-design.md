# Langkah 2 — Accounting: GL Engine + Auto-Journal (Sinkron)

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Part of:** Program fitur tambahan Vobia (0 sidebar ✅ → 1 surat/ACC ✅ → **2 akunting** → 3 HR/payroll). Ini menutup Fase C/D roadmap lama (GL penuh) minus pajak & migrasi Accurate.

## Context

Vobia = multi-tenant fashion ERP (Next.js 16 + Supabase, RLS). Semua pergerakan
uang/stok sudah punya "single write path": `record_movement` → `stock_ledger`
(barang jadi), `record_material_movement` → `material_ledger` (bahan),
`cost_entries` (biaya produksi), `create_order` (penjualan). Belum ada
pembukuan (buku besar). Tujuan: ERP mulai memegang buku sendiri, jurnal terisi
otomatis dari transaksi yang sudah ada → Neraca & Laba-Rugi hidup tanpa input
ganda. Basis **akrual**.

Keputusan bisnis (brainstorming 2026-07-13): ganti Accurate total, tapi
dibangun bertahap. Batu ini = **mesin GL + auto-jurnal + laporan**. Di luar
scope: PPN/faktur (batu 3), migrasi saldo Accurate + parallel run (batu 4,
butuh akuntan). Bagan akun = template standar fashion.

## Arsitektur inti

**Auto-jurnal lewat trigger, bukan modifikasi RPC.** Karena tiap event sudah
punya single write path, pasang `AFTER INSERT` trigger di `material_ledger`,
`stock_ledger`, dan `cost_entries`. Trigger membaca baris + ref-nya, menghitung
nilai, lalu memanggil `post_journal(...)`. Tidak menyentuh RPC existing →
decoupled, otomatis mencakup penulisan masa depan. Konsisten dengan filosofi
"ledger = satu-satunya penulis".

## Data model

```
accounts
  id uuid pk, tenant_id uuid, code text, name text,
  type text check in ('aset','kewajiban','modal','pendapatan','beban'),
  normal_balance text check in ('debit','kredit'),
  is_contra boolean default false, active boolean default true,
  unique (tenant_id, code)

journals
  id uuid pk, tenant_id uuid, journal_date date not null default current_date,
  memo text, source_type text, source_id uuid,   -- e.g. ('sale', order_id)
  created_by uuid, created_at timestamptz default now()

journal_lines
  id uuid pk, tenant_id uuid, journal_id uuid references journals on delete cascade,
  account_id uuid references accounts, debit numeric(16,2) default 0,
  credit numeric(16,2) default 0, memo text,
  check (debit >= 0 and credit >= 0 and not (debit > 0 and credit > 0))
```

RLS `tenant_isolation` pada ketiganya. `journal_lines`/`journals` append-only
untuk `authenticated` (revoke insert/update/delete); `post_journal` (security
definer) satu-satunya penulis, seperti pola ledger existing.

### Bagan akun template (di-seed per tenant)

| Kode | Nama | Tipe | Saldo normal |
|---|---|---|---|
| 1-1100 | Kas | aset | debit |
| 1-1200 | Bank | aset | debit |
| 1-1210 | Piutang Marketplace | aset | debit |
| 1-1300 | Persediaan Bahan | aset | debit |
| 1-1310 | Barang Dalam Proses | aset | debit |
| 1-1320 | Persediaan Barang Jadi | aset | debit |
| 1-1600 | Aset Tetap | aset | debit |
| 1-1700 | Akumulasi Penyusutan | aset | kredit (kontra) |
| 2-1100 | Hutang Usaha | kewajiban | kredit |
| 2-1200 | Hutang Pajak | kewajiban | kredit |
| 2-1300 | Hutang Gaji | kewajiban | kredit |
| 3-1000 | Modal | modal | kredit |
| 3-1100 | Laba Ditahan | modal | kredit |
| 4-1000 | Penjualan | pendapatan | kredit |
| 4-1100 | Retur Penjualan | pendapatan | debit (kontra) |
| 5-1000 | HPP | beban | debit |
| 5-1100 | Beban Gaji | beban | debit |
| 5-1200 | Beban Operasional | beban | debit |
| 5-1300 | Beban Penyusutan | beban | debit |

Seed lewat fungsi `seed_accounts(tenant)`; dipanggil dari `handle_new_user`
(tenant baru) dan backfill sekali untuk tenant existing.

## post_journal (engine)

`post_journal(p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb) returns uuid`
- `security definer`, tenant dari JWT.
- `p_lines` = array `{account_code, debit, credit, memo?}`.
- Resolve tiap `account_code` → `account_id` milik tenant; error kalau tak ada.
- Validasi: minimal 2 baris, `sum(debit) = sum(credit)` (toleransi 0), tiap baris
  hanya salah satu sisi > 0, total > 0.
- Insert `journals` + `journal_lines`. Return journal id.
- Idempoten per sumber: kalau `(source_type, source_id)` sudah ada jurnal, no-op
  (cegah double-post saat trigger jalan ulang / reprocessing).

## Valuasi (persediaan perpetual, disederhanakan)

Nilai diambil dari tabel sumber saat trigger jalan:
- **Harga rata-rata bahan** = `sum(qty_ordered*unit_price)/sum(qty_ordered)`
  dari `purchase_lines` per material.
- **Biaya per unit produksi (per PO)** = `(nilai bahan di-issue ke PO + biaya
  cost_entries PO non-material) / total qty_received PO`. Dipakai saat barang
  jadi masuk.
- **Biaya rata-rata barang jadi per SKU** (untuk HPP saat jual) = view
  `sku_fg_cost`: total nilai produksi sku / total qty diproduksi.

## Pemetaan auto-jurnal

Trigger `material_ledger` AFTER INSERT (by `movement_type`):
- `purchase_in`: **Dr 1-1300** / **Cr 2-1100** @ `qty × unit_price` (ref purchase_line).
- `issue_out`: **Dr 1-1310** / **Cr 1-1300** @ `qty × avg_bahan`.
- `transfer_in/out`, `adjustment`: **tidak dijurnal** (MVP — flag).

Trigger `cost_entries` AFTER INSERT:
- type `cmt`/`overhead`/`other`: **Dr 1-1310** / **Cr 2-1100** @ `amount`.
- type `material`: **dilewati** (nilai material sudah lewat issue; hindari dobel).
  Flag UI: "dengan pembukuan aktif, catat bahan lewat Issue; cost entry untuk
  jahit/overhead saja."

Trigger `stock_ledger` AFTER INSERT (by `movement_type`):
- `production_in`: **Dr 1-1320** / **Cr 1-1310** @ `qty × biaya_per_unit_PO`.
- `sale_out`: dua jurnal —
  (a) pendapatan: **Dr 1-1210** / **Cr 4-1000** @ `qty × unit_price` (ref order_line);
  (b) HPP: **Dr 5-1000** / **Cr 1-1320** @ `qty × sku_fg_cost`.
- `return_in`: kebalikan sale —
  (a) **Dr 4-1100** / **Cr 1-1210** @ `qty × unit_price`;
  (b) **Dr 1-1320** / **Cr 5-1000** @ `qty × sku_fg_cost`.
- `transfer_in/out`, `adjustment`: **tidak dijurnal** (MVP — flag).

**Saldo awal:** fungsi `post_opening_balance()` — 1 jurnal per tenant:
Dr `1-1300` (nilai persediaan bahan saat ini) + Dr `1-1320` (nilai barang jadi
saat ini) / Cr `3-1000 Modal`. Supaya Neraca seimbang dari hari pertama tanpa
replay history. Dipanggil sekali untuk tenant simulasi.

## Laporan

View + halaman:
- **Neraca Saldo** (`trial_balance`): per akun `sum(debit) - sum(credit)` → saldo
  debit/kredit; total debit = total kredit.
- **Laba-Rugi**: pendapatan (tipe `pendapatan`, dikurangi kontra) − beban (tipe
  `beban`) = laba bersih. Filter periode (tanggal jurnal).
- **Neraca**: aset = kewajiban + modal + laba berjalan. Per tanggal.

## UI (menu baru "Keuangan")

- `/accounts` — daftar bagan akun (tambah/edit/nonaktif).
- `/journals` — daftar jurnal + detail; form **Jurnal Manual** (tanggal, memo,
  baris debit/kredit, tombol nolak kalau tak seimbang).
- `/reports/trial-balance`, `/reports/income`, `/reports/balance-sheet`.
- Sidebar: grup baru **Keuangan** (Bagan Akun, Jurnal, Laporan).

## Testing

- **pgTAP:** (a) `post_journal` tolak jurnal tak seimbang; (b) idempoten per
  source; (c) trigger purchase_in → jurnal Dr Persediaan/Cr Hutang benar;
  (d) sale_out → 2 jurnal (pendapatan + HPP); (e) trial_balance total D = K;
  (f) cross-tenant isolasi.
- **Vitest:** util laporan (agregasi L-R/Neraca) bila ada logika murni.
- **Playwright:** jurnal manual seimbang tersimpan & muncul di neraca saldo;
  buat penjualan → laporan L-R nambah pendapatan + HPP.

## Acceptance

- Bagan akun ter-seed; jurnal manual seimbang bisa disimpan, yang timpang ditolak.
- Beli/issue/biaya/produksi/jual/retur otomatis bikin jurnal yang benar.
- Neraca Saldo selalu balance (D = K).
- L-R & Neraca keluar angka masuk akal dari data simulasi (setelah opening balance).
- RLS: tenant tak bisa lihat/pos jurnal tenant lain.
- Transfer & adjustment sengaja belum dijurnal (didokumentasikan).

## Simplifikasi yang di-flag (upgrade nanti)

- Belum ada PPN/faktur pajak & PPh (batu 3).
- Belum migrasi saldo/history Accurate (batu 4, butuh akuntan) — pakai opening balance ringkas.
- Transfer antar-lokasi & adjustment stok belum dijurnal.
- COGS pakai rata-rata sederhana; belum FIFO/standar; belum variance analysis.
- Penyusutan aset tetap manual (jurnal manual), belum terjadwal.
