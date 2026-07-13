# Langkah 3 — HR + Payroll (komponen bisa diatur)

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Part of:** Program fitur tambahan Vobia (0 ✅ sidebar → 1 ✅ surat → 2 ✅ akunting → **3 HR/payroll**).

## Context

Vobia = multi-tenant fashion ERP (Next.js 16 + Supabase, RLS). Langkah 2 sudah
menghadirkan mesin GL + `post_journal` (double-entry, append-only) + auto-jurnal.
Langkah 3 menambah data pekerja & proses gaji bulanan yang **auto-jurnal** ke GL.

Keputusan bisnis (brainstorming 2026-07-13): payroll dengan **komponen gaji yang
bisa diatur** (tunjangan/potongan/pajak = tarif/nilai yang di-set user), BUKAN
mesin PPh21/BPJS statutori otomatis (hindari usang & risiko kepatuhan). Absensi
harian detail, BPJS employer, THR terjadwal = ditunda.

## Data model

```
employees (id, tenant_id, name, position, placement, join_date,
           base_salary numeric(14,2), bank_account text,
           active boolean default true, created_at)

pay_components (id, tenant_id, name,
   kind text check in ('tunjangan','potongan'),
   calc text check in ('nominal','persen'),   -- persen = % of base_salary
   value numeric(14,2), is_tax boolean default false,  -- is_tax -> Hutang Pajak
   active boolean default true, created_at)

payroll_runs (id, tenant_id, period text,      -- 'YYYY-MM'
   status text check in ('draft','posted') default 'draft',
   journal_id uuid, posted_at timestamptz, created_at,
   unique (tenant_id, period))

payslips (id, tenant_id, run_id, employee_id,
   base_salary numeric(14,2), tunjangan_total numeric(14,2) default 0,
   overtime numeric(14,2) default 0, deduction_total numeric(14,2) default 0,
   tax_total numeric(14,2) default 0,
   gross numeric(14,2) generated always as (base_salary+tunjangan_total+overtime) stored,
   net   numeric(14,2) generated always as (base_salary+tunjangan_total+overtime-deduction_total-tax_total) stored,
   created_at)

payslip_lines (id, tenant_id, payslip_id, label, kind text, amount numeric(14,2))
   -- kind in ('tunjangan','potongan','pajak') for the slip breakdown
```

RLS `tenant_isolation` (all/select) semua tabel. `employees`,
`pay_components`, `payslips` (overtime edit saat draft) dapat insert/update via
grants; `payroll_runs`/`payslips`/`payslip_lines` diisi lewat RPC generate.

## RPC

**`generate_payroll(p_period text) returns uuid`** (security definer, tenant dari JWT):
- Buat `payroll_runs` draft untuk period (unik per tenant/period).
- Untuk tiap employee `active`: hitung
  - `tunjangan_total` = Σ komponen aktif `kind='tunjangan'` (`nominal` → value; `persen` → value/100*base).
  - `deduction_total` = Σ komponen `kind='potongan' AND NOT is_tax`.
  - `tax_total` = Σ komponen `kind='potongan' AND is_tax`.
  - insert `payslips` (overtime 0) + `payslip_lines` breakdown per komponen.
- Return run id.

**`post_payroll(p_run_id uuid) returns uuid`** (security definer):
- Guard: run milik tenant & `status='draft'`.
- Total: `beban=Σgross`, `pajak=Σtax_total`, `hutang_gaji=Σ(net+deduction_total)`.
- Panggil `_post_journal(tenant, uid, date, 'Gaji '||period, 'payroll', run_id, lines)`:
  Dr `5-1100 Beban Gaji` = beban; Cr `2-1200 Hutang Pajak` = pajak;
  Cr `2-1300 Hutang Gaji` = hutang_gaji. (beban = pajak + hutang_gaji.)
- Set `status='posted'`, `journal_id`, `posted_at`.

Overtime diedit lewat UPDATE `payslips.overtime` (action, hanya saat draft);
`gross`/`net` generated → ikut otomatis.

## UI (grup sidebar "HR")

- `/employees` — daftar + form karyawan.
- `/pay-components` — daftar + form komponen gaji (jenis, cara hitung, nilai, pajak?).
- `/payroll` — daftar run + form "Proses Gaji" (pilih period → generate).
- `/payroll/[id]` — detail run: tabel payslip (base, tunjangan, overtime editable,
  potongan, pajak, net), badge draft/posted, tombol **Posting** (→ jurnal).
- `/payroll/[id]/slip/[payslipId]` — slip gaji cetak (print CSS `.surat`).

## Testing

- **pgTAP:** (a) `generate_payroll` bikin payslip dengan tunjangan persen + nominal
  benar; (b) net = gross − potongan − pajak; (c) `post_payroll` bikin jurnal
  seimbang (Beban = Hutang Pajak + Hutang Gaji) & tak bisa post 2x; (d) cross-tenant.
- **Playwright:** tambah karyawan + komponen → proses gaji → posting → L-R nambah Beban Gaji.

## Acceptance

- Karyawan & komponen bisa dibuat/diedit.
- Proses gaji hitung slip benar (tunjangan nominal & persen, potongan, pajak, net).
- Posting bikin jurnal seimbang & muncul di Neraca Saldo / L-R.
- Run tak bisa diposting dua kali; overtime hanya bisa diubah saat draft.
- RLS: tenant tak lihat data HR tenant lain.

## Simplifikasi (di-flag)

- Absensi harian belum ada (lembur/potongan diinput manual per run).
- PPh21/BPJS = komponen manual (bukan mesin statutori).
- BPJS employer, THR terjadwal, multi-run per bulan belum ada.
- Slip belum kirim email; cetak lewat browser.
