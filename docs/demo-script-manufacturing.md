# Demo Script — Alur Manufaktur Hulu (P1–P3)

Panduan klik langkah-demi-langkah buat presentasi. Login → Perencanaan → PPIC → Procurement → nyambung ke sistem existing.

**Login:** `superadmin@vobia.com` / `password123` (server dev di http://localhost:3100)

Alur besar:
```
Forecast → Proyeksi (kunci) → PCB → PPO → pecah PO (FOB/CMT) → bayar → terima di Pembelian
   P1            P1            P2     P3         P3            P3          existing
```

---

## BAGIAN 1 — PERENCANAAN (P1)

### Langkah 1 — Forecast
- **Pencet:** sidebar **PERENCANAAN → Forecast**
- **Muncul:** 2 forecast 2026-Q3 (jenis **Sales** + **Operasional**), tiap baris punya qty per style.
- **Jelasin ke klien:** "Tim Sales bikin proyeksi murni dari demand pasar. Tim Operasi bikin versi sendiri yang disesuaikan KPI (ITO, stock ratio). Dua-duanya masuk sistem."
- *(Opsional, tunjuk input)* isi form kanan: Jenis Sales, Periode `2026-Q4`, tambah baris style + qty, **Buat Forecast**.

### Langkah 2 — Proyeksi (alignment + kunci)
- **Pencet:** sidebar **Proyeksi**
- **Muncul:** proyeksi 2026-Q3 status **Terkunci**, total 650.
- **Pencet:** klik baris proyeksi itu → detail 2 baris: VB-MIRA 450 (Regular) + VB-LUNA 200 (Seasonal · Raya Capsule).
- **Jelasin:** "Di meeting alignment, forecast Sales & Ops dinego jadi satu angka final. Begitu sepakat, dikunci jadi Proyeksi — **gak bisa diubah lagi**, jadi patokan resmi semua proses hilir."
- *(Opsional, tunjuk alignment)* di list Proyeksi, form kanan pilih periode yang punya forecast → tabel Sales vs Ops per style → isi kolom Final → **Buat Proyeksi** → masuk detail draft → **Kunci**.

### Langkah 3 — Produk Baru (seasonal)
- **Pencet:** sidebar **Produk Baru**
- **Muncul:** "Raya Capsule 2026" — R&D **Selesai**, Marketing **Tervalidasi**, qty disepakati 200, badge "siap masuk proyeksi".
- **Jelasin:** "Produk seasonal baru: R&D desain dulu, Marketing tes pasar (cek ombak). Begitu qty disepakati, otomatis bisa dimasukin ke Proyeksi sebagai baris seasonal."

---

## BAGIAN 2 — PPIC (P2)

### Langkah 4 — Buat PCB dari Proyeksi
- **Pencet:** buka **Proyeksi → klik proyeksi terkunci → tombol "Buat PCB dari proyeksi ini →"**
- **Muncul:** form PCB. Tiap style ke-prefill otomatis:
  - **Target Sales** = qty dari proyeksi
  - **Ending Stock** = stok gudang saat ini (dihitung dari ledger)
  - **Kebutuhan** = Ending Stock + Target Sales (formula SOP)
- **Pencet:** isi **Biaya/unit** tiap style → Subtotal & **Total nilai** ngitung otomatis → **Buat PCB**.
- **Jelasin:** "PCB = Production Cost Breakdown, dibuat kuartalan. Rumus kebutuhan beli = stok akhir + target jual. Dikali biaya per unit → total belanja kuartal ini."

### Langkah 5 — Lihat PCB (roll-up kuartalan)
- **Muncul:** detail PCB — tabel semua style + **Total roll-up kuartalan** di bawah.
- **Jelasin:** "Ini proyeksi total pengeluaran operasional kuartal, buat budgeting sebelum PO dipecah."

---

## BAGIAN 3 — PROCUREMENT (P3)

### Langkah 6 — Buat PPO (induk PO)
- **Pencet:** di detail PCB, form **Buat PPO** kanan → pilih **Style**, **Skema**, Qty (default = kebutuhan) → **Buat PPO**.
- **Dua skema, jelasin bedanya:**
  - **FOB** (Free On Board) = beli barang jadi dari 1 vendor. Admin gampang. PPO → 1 PO. Bayar: DP → barang → pelunasan.
  - **CMT** (Cut-Make-Trim) = produksi dipecah ke banyak vendor spesialis. Admin ribet. PPO → banyak anak PO. Bayar tiap vendor terpisah.

### Langkah 7 — Terbitkan & pecah anak PO
- **Muncul (kalau CMT):** form otomatis kasih **4 baris**: Bahan / Jahit / Bordir / Aksesoris.
- **Pencet:** tiap baris pilih **vendor** + isi **Nilai PO**. Baris **Bahan** boleh pilih bahan + qty + harga (opsional). → **Terbitkan PO**.
- **Muncul:** PPO status jadi **Terbit**, muncul **4 anak PO** (kode `-A / -B / -C / -D`), masing-masing vendor sendiri.
- **Jelasin:** "1 PPO induk otomatis pecah jadi PO operasional per vendor. FOB cuma 1 anak (barang jadi); CMT sampai 4 (bahan, jahit, bordir, aksesoris)."

### Langkah 8 — Pembayaran per anak PO
- **Pencet:** di baris anak PO, panel Pembayaran → pilih jenis (**DP / Pelunasan / Penuh**) + isi jumlah → tombol **+**.
- **Pencet:** tombol **Tandai Lunas** → badge berubah **Belum Bayar → Lunas**.
- **Jelasin:** "Tiap vendor dibayar terpisah, statusnya kelacak per PO."

### Langkah 9 — Nyambung ke sistem existing
- **Pencet:** klik kode anak PO **Bahan** (link) → masuk modul **Pembelian**.
- **Muncul:** layar PO bahan biasa — tombol **ACC** (approval), tabel penerimaan (Order/Diterima/Sisa), input Terima.
- **Jelasin:** "PO bahan dari alur manufaktur langsung masuk ke modul Pembelian yang udah ada. ACC dulu, terima barang → stok bahan naik → lanjut ke Produksi (trial → mass → QC) → Gudang. Semua satu sistem."

---

## Ringkasan alur 1 kalimat
Sales & Ops bikin forecast → dinego & **dikunci jadi Proyeksi** → dihitung jadi **PCB** (budget kuartal) → dibikin **PPO induk** → **dipecah jadi PO vendor** (FOB 1 / CMT 4) → **dibayar** → **diterima di Pembelian** → masuk Produksi & Gudang.

## Catatan buat presentasi
- Data contoh udah ke-seed (2026-Q3): 2 forecast, 1 proyeksi terkunci, 1 PCB, 2 PPO (FOB + CMT). Bisa langsung ditunjuk tanpa bikin dari nol.
- Kalau mau demo bikin-dari-nol: pakai periode baru (mis. 2026-Q4) biar gak bentrok sama data terkunci Q3.
- Yang belum (fase lanjut, kalau klien nanya): pembayaran auto-post ke GL, KPI ops auto-hitung, approval PCB. Lihat `docs/superpowers/specs/2026-07-16-manufacturing-upstream-design.md`.
