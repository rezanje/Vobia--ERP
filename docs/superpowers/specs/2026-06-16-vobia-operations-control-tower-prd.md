# PRD: MVP VOBIA Operations Control Tower

Tanggal: 2026-06-16
Sumber: Jawaban VOBIA Business & Operations Discovery, dikirim 2026-06-11
Input pemilik bisnis: Aditya Saputra

## 1. Latar Belakang

VOBIA adalah bisnis fashion commerce yang sudah berjalan 3-5 tahun dengan lebih dari 5.000 order per bulan, 50-200 SKU aktif, dan tim berjumlah 16-30 orang. Channel penjualan saat ini mencakup Shopee, TikTok Shop, dan website sendiri. Tools yang digunakan saat ini adalah Spreadsheet, Jubelio, dan Accurate.

VOBIA sudah cukup mampu mendatangkan demand dari market, tetapi sisi supply dan operasional belum cukup efisien untuk memenuhi kebutuhan penjualan secara konsisten. Pain point operasional utama berpusat pada development monitoring, production monitoring, inventory turnover monitoring, dan reporting operasional.

## 2. Tujuan Produk

Membangun MVP Control Tower yang memberi management dan tim operasional satu pusat kontrol untuk memonitor product development, produksi, inventory turnover, dan kesiapan fulfillment.

MVP harus membantu VOBIA menjawab pertanyaan berikut secara cepat:

- Produk mana yang sedang development, produksi, QC, ready stock, atau distribusi?
- Batch produksi mana yang terlambat atau berisiko terlambat?
- Vendor/penjahit mana yang performanya baik atau buruk?
- SKU mana yang bergerak cepat, bergerak lambat, atau menahan stok terlalu lama?
- Bottleneck mana yang membuat supply belum bisa mengikuti demand?
- Report mana yang perlu dilihat management secara harian atau mingguan?

## 3. Ruang Lingkup MVP

### Termasuk Scope

- Dashboard operasional harian
- Product/project tracker
- Production monitoring per batch dan vendor
- Inventory turnover monitoring
- Vendor performance reporting
- Reporting and analytics layer
- CSV/manual import dari export Spreadsheet, Jubelio, dan Accurate
- Filter berdasarkan SKU, vendor, collection, status, dan date range
- Export report ke CSV/XLSX

### Di Luar Scope

- Pengganti penuh sistem akuntansi Accurate
- Pengganti marketplace order management Jubelio
- Optimasi detail warehouse bin/location
- Supplier procurement automation penuh
- Mobile vendor portal
- Advanced demand forecasting

## 4. User dan Role

### Owner / Management

Butuh visibilitas cepat terhadap kondisi bisnis dan bottleneck operasional. Bisa melihat dashboard, drill-down report, dan export summary.

### Operations Lead

Bertanggung jawab atas monitoring project dan produksi harian. Bisa update status project, status produksi, bottleneck, dan notes.

### Production Admin

Mengelola data vendor, production order, QC, progress, deadline, reject, dan delay.

### Inventory / Admin Team

Mengelola snapshot stok finished goods dan mengecek pergerakan SKU, turnover, slow-moving item, dan fast-moving item.

### Finance

Menggunakan Accurate sebagai source of truth finance. Bisa memakai data HPP, cost, dan margin di Control Tower jika sudah di-import, tetapi MVP ini bukan sistem akuntansi penuh.

## 5. Modul

### 5.1 Executive Operations Dashboard

Tampilan ringkasan untuk review harian management.

Widget utama:

- Active projects
- Production by status
- Overdue production
- Inventory turnover summary
- Slow-moving SKU count
- Fast-moving SKU count
- Vendor performance summary
- Open operational issues

### 5.2 Product / Project Management

Melacak setiap produk atau SKU dari development sampai siap distribusi.

Field utama:

- SKU
- Product name
- Collection/drop
- Product status
- Owner
- Target launch date
- Linked production batch
- Channel readiness
- Notes

Status yang direkomendasikan:

- Idea
- Development
- Techpack Ready
- Sampling
- Production Planned
- In Production
- QC
- Ready Stock
- Live
- Paused
- Canceled

### 5.3 Production Monitoring

Melacak batch produksi di berbagai vendor/penjahit eksternal.

Field utama:

- Production order ID
- SKU
- Product name
- Quantity
- Vendor/penjahit
- Start date
- Deadline
- Current status
- Progress percentage
- Delay flag
- Delay reason
- QC status
- Reject count
- Notes

Status yang direkomendasikan:

- Planned
- Material Ready
- In Progress
- QC
- Rework
- Ready
- Delayed
- Canceled

### 5.4 Inventory Turnover Monitoring

Melacak pergerakan finished goods dan efisiensi inventory.

Field utama:

- SKU
- Product name
- Collection/drop
- Stock on hand
- Units sold in period
- Average daily sales
- Days of inventory
- Turnover rate
- Slow-moving flag
- Fast-moving flag

Formula awal:

- Average daily sales = units sold in period / jumlah hari dalam periode
- Days of inventory = stock on hand / average daily sales
- Turnover rate = units sold in period / average stock

Jika data sales atau average stock belum tersedia, report harus menandai row sebagai incomplete agar tidak menghasilkan angka yang menyesatkan.

### 5.5 Reporting and Analytics Layer

Report prioritas:

- Production Monitoring Report
- Inventory Turnover Report
- Merchandising Report
- Vendor Performance Report
- Operational Bottleneck Report

Report harus mendukung:

- Filter berdasarkan SKU, collection, vendor, status, dan date range
- Export ke CSV/XLSX
- Timestamp yang jelas untuk last data update
- Peringatan dasar untuk data yang belum lengkap

## 6. Sumber Data

### Spreadsheet

Sumber awal untuk data product/project dan production monitoring.

### Jubelio

Sumber awal untuk data order, sales, channel, dan finished goods stock jika export tersedia.

### Accurate

Sumber awal untuk referensi finance, HPP, cost, dan margin jika export tersedia.

### Pendekatan Import

MVP menerima CSV/manual upload terlebih dahulu. API integration ditunda sampai struktur data dan kebutuhan reporting sudah stabil.

Kemampuan import yang dibutuhkan:

- Upload CSV
- Mapping kolom sumber ke field sistem
- Validasi required fields
- Flag untuk SKU/vendor name yang belum dikenal
- Import summary: rows created, rows updated, rows skipped, validation errors

## 7. Kebutuhan Fungsional

### P0 Wajib Ada

- Dashboard menampilkan ringkasan operasional dari data yang di-import.
- Product/project tracker mendukung create, edit, filter, dan status update.
- Production tracker mendukung create, edit, filter, status update, deadline, vendor, progress, dan QC fields.
- Sistem otomatis memberi flag delayed production jika current date sudah melewati deadline dan status belum ready/canceled.
- Inventory turnover report menghitung movement metrics dari data stok dan sales.
- Slow-moving dan fast-moving SKU flags bisa dikonfigurasi berdasarkan threshold.
- Vendor performance report merangkum total batches, delayed batches, average delay, QC reject count, dan completion rate.
- CSV/manual import mendukung source data dari export Spreadsheet, Jubelio, dan Accurate.
- Report bisa difilter dan diexport ke CSV/XLSX.

### P1 Sebaiknya Ada

- Issue comments dan notes per production batch.
- Link techpack atau dokumen per SKU/project.
- QC reject tracking berdasarkan reason.
- Alert list untuk overdue production dan slow stock.
- Basic merchandising report berdasarkan SKU, collection, dan channel.

### P2 Nanti

- Jubelio API integration
- Accurate API integration
- Supplier PO management
- Warehouse location management
- Vendor portal
- Demand forecasting

## 8. Kebutuhan Non-Fungsional

- Dashboard harus memuat common filtered views dalam waktu kurang dari 3 detik untuk data berukuran MVP.
- Import validation harus memberi error yang jelas sampai level row.
- Management user default-nya hanya view-only.
- Ops/admin user bisa edit data operasional.
- Sistem harus menyimpan import history untuk auditability.
- Report harus menampilkan last updated timestamp.
- Data model harus mendukung API integration di masa depan tanpa desain ulang core entities.

## 9. Metrik Keberhasilan

- Management bisa review status produksi dan inventory dalam kurang dari 5 menit per hari.
- Tim operasional tidak perlu lagi menggabungkan banyak spreadsheet secara manual untuk report prioritas.
- Overdue production terlihat otomatis.
- Slow-moving dan fast-moving SKU bisa diidentifikasi mingguan.
- Production Monitoring, Inventory Turnover, Merchandising, dan Vendor Performance reports bisa dibuat rutin dari data sistem.
- Minimal operations lead dan production admin update data operasional setiap hari kerja.

## 10. Risiko dan Asumsi

### Risiko

- Nama SKU bisa berbeda antar export Spreadsheet, Jubelio, dan Accurate.
- Akurasi dashboard bergantung pada update data yang tepat waktu.
- Vendor masih mungkin memberi update via WhatsApp, sehingga admin perlu input ulang.
- Data Accurate belum tentu selalu terstruktur untuk HPP per SKU.
- Data discovery berasal dari satu stakeholder response, sehingga PRD ini perlu divalidasi dengan user operasional sebelum implementasi.

### Asumsi

- VOBIA menerima CSV/manual import untuk MVP.
- Jubelio dan Accurate tetap menjadi sistem aktif.
- Release pertama mengutamakan visibilitas management sebelum workflow automation.
- Target timeline adalah 1-2 bulan.
- Budget belum fixed, sehingga MVP harus menghindari integration work yang berat.

## 11. Kriteria Penerimaan

- Sample CSV import berhasil dengan field mapping yang valid.
- Import process memberi flag untuk required fields yang kosong dan unknown SKU/vendor values.
- Total di dashboard sesuai dengan source data yang di-import.
- Production delay flag muncul ketika deadline sudah lewat dan produksi belum selesai.
- Nilai inventory turnover sesuai formula yang terdokumentasi.
- Slow-moving dan fast-moving flags mengikuti threshold yang dikonfigurasi.
- Vendor report menghitung delayed batches, completion rate, dan reject counts dengan benar.
- Filter berjalan untuk SKU, vendor, collection, status, dan date range.
- Exported reports bisa dibuka dengan benar sebagai CSV/XLSX.
- Role permissions mencegah view-only users mengedit data operasional.

## 12. Keputusan Terbuka Sebelum Implementasi

- Konfirmasi platform first release: web app, internal admin app, atau spreadsheet-powered dashboard.
- Konfirmasi preferred stack dan hosting environment.
- Definisikan threshold slow-moving dan fast-moving.
- Kumpulkan sample export dari Spreadsheet, Jubelio, dan Accurate.
- Konfirmasi canonical SKU list dan naming convention.
- Konfirmasi apakah PRD ini akan menjadi implementation plan untuk codebase ERP existing atau MVP build baru.
