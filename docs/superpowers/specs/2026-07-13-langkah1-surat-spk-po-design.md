# Langkah 1 — Surat SPK Produksi + PO Bahan (Draft → ACC → Cetak)

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Part of:** Program fitur tambahan Vobia (Langkah 0 ✅ sidebar → **1** surat/ACC → 2 akunting → 3 HR/payroll)

## Context

Vobia = multi-tenant fashion ERP (Next.js 16 + Supabase, RLS). Order produksi
(`production_orders` + `prod_lines`, stage machine `trial→mass_production→qc→
completed`) dan PO bahan (`purchase_orders` + `purchase_lines`, status
`open→received→canceled`) sudah ada, tapi **dibuat langsung tanpa tahap
persetujuan** dan **tanpa surat cetak**.

Setelah rapat internal menentukan batch produksi, Vobia butuh dokumen resmi
(Surat Perintah Kerja ke konveksi, Purchase Order ke supplier bahan) yang keluar
lewat tahap persetujuan. Keputusan bisnis (lihat sesi brainstorming 2026-07-13):
approval **1 lapis**, surat lewat **cetak browser** (bukan mesin PDF), nomor
surat **numpang kode existing**.

## Scope

### Termasuk

- Lapisan status dokumen **draft → approved** di `production_orders` DAN
  `purchase_orders` (orthogonal ke `stage`/`status` yang sudah ada).
- Aksi **ACC** (approve) — hanya role `owner` / `ops`, dicatat siapa + kapan.
- **Rem otomatis:** selama `draft`, aksi hilir diblok —
  `issue_material_to_po` (produksi) dan `receive_purchase` (PO bahan) menolak
  jika dokumen belum `approved`.
- Halaman **surat cetak** print-friendly untuk SPK produksi & PO bahan; tombol
  Cetak hanya muncul saat `approved`. User pakai browser "Save as PDF".
- Badge status (draft/resmi) + tombol ACC di halaman detail produksi & PO.

### Di luar scope (upgrade nanti)

- Format nomor surat resmi (mis. `SPK/VOBIA/2026/VII/001`) + sekuens per tahun.
- Approval multi-lapis, riwayat revisi, tolak-dengan-alasan.
- Generasi PDF server-side / e-signature.
- Konsep "batch/rapat" sebagai entitas terpisah — cukup 1 dokumen = 1 order.

## Data model

Tambah kolom ke **`production_orders`** dan **`purchase_orders`** (pola identik):

```
doc_status  text not null default 'draft' check (doc_status in ('draft','approved'))
approved_by uuid references auth.users(id)
approved_at timestamptz
```

- Nullable `approved_by`/`approved_at`, terisi saat ACC.
- Baris lama (data seed simulasi) di-backfill `approved` supaya alur existing
  (issue/receive yang sudah terjadi) tidak mendadak terblok. Migration:
  `update ... set doc_status='approved', approved_at=created_at`.
- RLS tetap: kolom baru ikut policy `tenant_isolation` yang sudah ada, tanpa
  policy baru.

## Approval (2 lapis validasi, sesuai prinsip ADR)

**DB function** `approve_document(p_kind text, p_id uuid)`:
- `p_kind in ('production','purchase')`.
- `security definer`, resolusi tenant dari `auth.jwt() ->> 'tenant_id'`.
- Guard role: `(auth.jwt() ->> 'user_role') in ('owner','ops')` — else
  `raise exception 'not authorized to approve'`. (`user_role` = claim aplikasi,
  bukan `role` reserved — lihat memory auth-role-claim-gotcha.)
- Guard tenant: dokumen harus milik tenant caller.
- Idempoten: kalau sudah `approved`, no-op (tidak error).
- Set `doc_status='approved'`, `approved_by=auth.uid()`, `approved_at=now()`.
- `grant execute ... to authenticated`.

**Server Action** `approveDocument(kind, id)`: panggil RPC, `revalidatePath` detail
+ list. Guard role juga di sisi action (cegah tombol bocor), pesan error ramah.

## Rem otomatis (gating)

- `issue_material_to_po`: di awal fungsi, `select doc_status ... into v_ds from
  production_orders where id=p_prod_po_id`; kalau `<> 'approved'` →
  `raise exception 'production order belum di-ACC'`.
- `receive_purchase`: guard sama sebelum memproses penerimaan; kalau PO belum
  `approved` → tolak.
- Pembuatan draft (create production order / PO) tetap bebas — rem hanya di aksi
  hilir yang menggerakkan stok/uang.

## Surat cetak

Route server component, render hanya jika `doc_status='approved'` (else redirect
ke detail):
- `/production/[id]/surat` — Surat Perintah Kerja.
- `/purchasing/[id]/surat` — Purchase Order.

Isi surat: logo Vobia (`/vobia-logo-white.png` versi cetak/hitam), nomor surat
(= `code`), tanggal, tujuan (nama vendor/supplier + kontak), tabel item
(SPK: SKU + qty_ordered; PO: material + qty_ordered + unit_price + subtotal),
deadline/tanggal, catatan, dan blok tanda tangan (nama `approved_by` + tanggal
ACC). CSS `@media print` + `@page`; tombol "Cetak / Simpan PDF" panggil
`window.print()`. Tidak ada dependency baru.

## UI

- Halaman detail produksi & PO: badge **Draft** (abu) / **Resmi** (aksen).
- Saat `draft` + role owner/ops: tombol **ACC**. Saat lain: badge saja.
- Saat `approved`: tombol **Cetak Surat** → buka route surat.
- Tombol issue material / receive di-disable + hint "ACC dulu" saat draft.

## Testing

- **pgTAP:** (a) `issue_material_to_po` & `receive_purchase` tolak saat draft,
  lolos saat approved; (b) `approve_document` tolak role non-owner/ops; (c)
  cross-tenant approve ditolak.
- **Vitest:** guard role di server action.
- **Playwright:** buat draft → ACC (as owner) → tombol Cetak muncul → halaman
  surat tampil dengan nomor + item benar.

## Acceptance

- Order produksi & PO baru default `draft`; tidak bisa issue/receive sampai ACC.
- Hanya owner/ops bisa ACC; tercatat siapa + kapan.
- Setelah ACC: surat cetak tampil, item & nomor sesuai; browser bisa Save as PDF.
- Data seed lama tetap jalan (ter-backfill approved).
- RLS: tenant lain tidak bisa ACC / lihat surat tenant lain.
