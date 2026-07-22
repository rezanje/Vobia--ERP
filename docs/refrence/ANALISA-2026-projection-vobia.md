# Analisa "2026 Projection Vobia" — cara kerja forecasting client

Sumber: `docs/refrence/Copy of 2026 Projection Vobia.xlsx` (38 tab, 683 baris SKU).
Dibaca dari rumus mentah, bukan dari nilai hasil.

---

## 1. Ringkasan dalam satu kalimat

Ini **bukan** model forecasting statistik. Ini **rolling inventory plan per SKU per bulan**:
mesinnya adalah identitas stok (`stok awal + masuk − jual = stok akhir`) yang dihitung
14 kolom per bulan × 12 bulan, sedangkan **angka penjualan bulan depan diisi manual**
oleh manusia. Rumus hanya dipakai untuk (a) merapikan aktual, (b) menghitung ulang
nilai rupiah, (c) menurunkan KPI, dan (d) dua heuristik kecil untuk order beli.

---

## 2. Peta alur data

```
Google Sheet eksternal (master produk)
        │ IMPORTRANGE
        ▼
   [Bank Data]  ── master SKU: SKU, Parent SKU, Article, Category, Sub Category,
        │           Variant, Sub Variant, Status Product, COGS, Retail Price
        │ VLOOKUP (kolom B–I)
        ▼
[Projection 2026]  ◄── SUMIFS ── [sales 2026] / [SALES JUNE] / [Sheet100]  (transaksi mentah)
   MESIN UTAMA                      (per invoice: tanggal, channel, SKU, qty, net, cogs, status bayar)
        │
        ├── HLOOKUP ──► [Summary]           (P&L + KPI, 12 bulan, seluruh brand)
        ├── SUMIFS   ──► [SUMMARY CATEGORY] (KPI yang sama, dipecah per Status Product)
        └── SUMIFS   ──► [Stock Monitoring] (KPI operasional per artikel, bulan berjalan)
```

Tab lain (`Pivot Table *`, `Sales Jan..Jun`, `Incoming`, `Inbound`, `KOL`, `Target Q2`,
`Size Availability`, dst) adalah data mentah / pivot / kertas kerja. Bukan sumber logika.

---

## 3. Mesin utama: tab `Projection 2026`

Satu baris = satu SKU. Kolom A–I = atribut (semua VLOOKUP ke `Bank Data`).
Kolom J–L = posisi awal (Ending Stock Desember 2025).
Setelah itu **14 kolom berulang untuk tiap bulan**, Januari sampai Desember:

| # | Kolom | Isi | Rumus |
|---|-------|-----|-------|
| 1 | Incoming QTY | barang datang | **input** (manual / rencana beli) |
| 2 | Incoming COGS | | qty × COGS |
| 3 | Incoming Gross | | qty × Retail Price |
| 4 | Beginning QTY | stok awal | `Ending QTY bulan lalu + Incoming QTY` |
| 5 | Beginning COGS | | qty × COGS |
| 6 | Beginning Gross | | qty × Retail |
| 7 | **Sales QTY** | penjualan | aktual (SUMIFS) atau **input manual** untuk bulan depan |
| 8 | Sales COGS | | qty × COGS |
| 9 | Sales Gross | | qty × Retail |
| 10 | Sales Net | | Sales Gross × **95%** |
| 11 | Ratio | | `Beginning QTY / Sales QTY` |
| 12 | Ending QTY | | `Beginning QTY − Sales QTY` |
| 13 | Ending COGS | | qty × COGS |
| 14 | Ending Gross | | qty × Retail |

Blok kolom: Jan `M–Z`, Feb `AA–AN`, Mar `AO–BB`, Apr `BC–BP`, Mei `BQ–CD`, Jun `CE–CR`,
Jul `CS–DF`, Agu `DG–DT`, Sep `DU–EH`, Okt `EI–EV`, Nov `EW–FJ`, Des `FK–FX`.
Baris 2 = grand total (`=sum(X5:X6126)`), baris 3 = nama bulan (dipakai sebagai key HLOOKUP).

**Catatan penting:** semua nilai rupiah dihitung ulang dari qty × harga master. Jadi
Gross itu **qty × retail price**, bukan omzet nyata setelah diskon. Nilai yang benar-benar
"uang masuk" hanya `Sales Net`.

### 3.1 Bulan yang sudah lewat — ambil aktual

```
Juni Sales QTY (CK) =
    SUMIFS('SALES JUNE'.QTY ; SKU=A5 ; Bulan="6. Juni")
  −  SUMIFS(... ; Status="Belum Bayar")
  −  SUMIFS(... ; Status="Belum dibayar")
  −  SUMIFS(... ; Status="Reture")
```
Reasoning: penjualan diakui hanya kalau **sudah dibayar dan tidak diretur**.
Sisi lemahnya: filter status di-hardcode sebagai string, dan "Belum Bayar" vs
"Belum dibayar" ditulis dua kali karena data mentahnya tidak konsisten.

### 3.2 Bulan berjalan — run-rate

```
Juli Sales QTY (CY) = (rumus aktual Juli yang sama di atas)
                      / ROUNDUP(DAY(NOW()-1),0)
                      * 27
```
Reasoning: ambil penjualan month-to-date, bagi jumlah hari yang sudah lewat →
rata-rata harian, lalu kali **27**. Jadi asumsinya **1 bulan = 27 hari jualan efektif**,
bukan 30. Ini asumsi paling berpengaruh dan tidak tertulis di mana pun.

### 3.3 Bulan depan — TIDAK ada rumus

Hasil hitung penuh 683 baris:

| Kolom | Formula | Angka ketik tangan | Nol |
|---|---|---|---|
| Agustus Sales QTY | 0 | 400 | 283 |
| September Sales QTY | 0 | 332 | 351 |
| Oktober Sales QTY | 0 | 261 | 422 |
| November Sales QTY | **3** | 254 | 426 |
| Desember Sales QTY | 0 | 256 | 427 |

Artinya: **forecast permintaan = judgment manusia, diketik langsung per SKU.**
Cuma 3 sel yang pakai rumus, dan rumusnya:

```
November Sales QTY = Oktober Sales QTY × 120%
```
→ asumsi pertumbuhan +20% bulan-ke-bulan, dipakai sporadis, tidak konsisten.

### 3.4 Rencana barang masuk — ada satu aturan nyata

```
September Incoming QTY (DU) = September Sales QTY × 1.5 − Agustus Ending QTY   (5 baris)
November  Incoming QTY (EW) = ROUND(November Sales QTY × 1.5, 0) − Oktober Ending QTY  (321 baris)
```

Diterjemahkan: **pesan barang sebanyak yang dibutuhkan supaya stok awal bulan itu
= 1.5 × forecast penjualan bulan itu.** Efeknya, tiap bulan ditutup dengan sisa stok
setengah bulan penjualan (buffer 0.5 bulan).

Angka **1.5 = target stock cover dalam bulan.** Ini asumsi bisnis paling penting di
seluruh file, dan hanya muncul sebagai konstanta di dalam rumus.

Bulan lain (Jul, Agu, Okt, Des) incoming-nya diketik manual — aturan 1.5 belum
diterapkan konsisten.

---

## 4. Tab output: `Summary`

Semua baris ditarik dari total baris 2 `Projection 2026` lewat
`HLOOKUP(nama_bulan & " " & nama_baris)`. Jadi Summary = tampilan, bukan perhitungan.

| Baris | Rumus | Arti bisnis |
|---|---|---|
| Incoming COGS / Gross | lookup | nilai belanja bulan itu |
| Beginning / Ending Stock Gross & COGS | lookup | nilai persediaan |
| Sales Gross / Net / COGS | lookup | penjualan |
| **Stock Ratio** | `Beginning Gross / Sales Gross` | stok awal setara berapa bulan penjualan |
| **ITO (YTD)** | `SUM(Sales COGS Jan..bulan ini) / ((Ending COGS tahun lalu + Ending COGS bulan ini)/2)` | inventory turnover kumulatif, pembagi = rata-rata persediaan |
| **GPM** | `(Sales Net − Sales COGS) / Sales Gross` | margin kotor |
| **Margin** | `Sales Net / Sales COGS` | markup (berapa kali lipat dari modal) |
| **ROI** | `Sales Gross / Incoming COGS` | tiap Rp1 belanja balik jadi berapa Rp penjualan |
| Ending COGS (Last Year) | `'Projection 2026'!K2` | saldo awal ITO |

Catatan: kolom `TOTAL` (N) memakai `=SUM(J:M)` — **hanya September–Desember**, bukan
setahun. Kemungkinan besar ini bug/sisa edit, bukan desain.
Baris GPM total pakai `N7 × 88%` → **potong PPN 12%**. Di `SUMMARY CATEGORY` baris yang
setara diberi label `Margin Before PPN`, jadi 88% memang faktor pajak.

`SUMMARY CATEGORY` = KPI identik, tapi dipecah per **Status Product** (`REGULAR`,
`ESSENTIAL+`, `Discontinue`, `Seasonal`, dst) pakai SUMIFS ke kolom I. Ini yang dipakai
buat keputusan "produk mana yang ditambah, mana yang dihentikan".

---

## 5. Tab `Stock Monitoring` — KPI operasional bulan berjalan

Per **artikel** (bukan SKU), 275 baris. Ini yang sebenarnya dipakai harian:

| Kolom | Rumus | Arti |
|---|---|---|
| Baseline / Uplift | SUMIFS by `Status Product` | penjualan organik vs hasil dorongan campaign |
| Qty Sold | Baseline + Uplift | |
| TARGET | **input manual** | target qty per artikel |
| GAP / Achievement | `Target − Sold`, `Sold / Target` | |
| AOV | `Net Sales / Qty Sold` | |
| **AVG Qty Sold/Day** | `Qty Sold / DAY(NOW()-1)` | run rate harian |
| **Projection** | `ROUNDUP(avg/day × 27, 0)` | proyeksi penjualan bulan penuh (lagi-lagi **27 hari**) |
| Inventory | SUMIFS ke `Projection 2026` Beginning QTY | stok tersedia |
| GAP stok | `MAX(0, Projection − Inventory)` | kekurangan barang bulan ini |
| **MOS** | `Inventory / avg_per_day / 30` | months of supply |
| **SSR** | `(Qty Sold + Inventory) / Qty Sold` | stock-to-sales ratio |
| Ratio | `Inventory / Projection` | |
| **Pareto / Rank** | kumulatif kontribusi net sales; `<=80%` → `TOP 20` | klasifikasi ABC |
| Stock Aging | `(hari ini − launching date) / 30` | umur produk dalam bulan |
| Disc Expense | `((Retail × Qty) − Net) / (Retail × Qty)` | % diskon efektif |
| **Stock Min** | `ROUND(avg/day × 30, 0)` | stok minimum = 30 hari penjualan |
| **Replenish** | `MAX(0, Stock Min − Inventory)` | usulan restock |
| GPM | `(Net − Sales COGS) / Gross` | |
| MARGIN | `Net / Sales COGS` | |

Perhatikan: di sini buffer-nya **30 hari (1 bulan)**, sedangkan di `Projection 2026`
buffer-nya **1.5 bulan**. Dua angka berbeda untuk konsep yang sama. Perlu dikonfirmasi
ke client mana yang benar / kapan pakai yang mana.

---

## 6. Daftar asumsi tersembunyi (magic numbers)

| Angka | Muncul di | Arti | Status |
|---|---|---|---|
| **27** | run-rate Projection 2026 & Stock Monitoring | hari jualan efektif per bulan | perlu konfirmasi |
| **1.5** | Incoming QTY Sep & Nov | target stock cover (bulan) | **asumsi inti** |
| **30** | Stock Min di Stock Monitoring | buffer minimum (hari) | bentrok dgn 1.5 bulan |
| **95%** | Sales Net = Gross × 95% | potongan diskon/fee marketplace | perlu konfirmasi |
| **120%** | November Sales QTY (3 sel) | growth MoM | dipakai tidak konsisten |
| **88%** | GPM total di Summary | net setelah PPN 12% | |
| **80%** | Pareto cutoff | batas TOP 20 | standar |
| **"Belum Bayar" / "Belum dibayar" / "Reture"** | filter sales aktual | status yang tidak diakui sbg penjualan | ejaan tidak konsisten di data |

---

## 7. Kelemahan yang layak diangkat ke client

1. **Forecast permintaan tidak punya metode.** 1.500+ angka diketik tangan tiap siklus.
   Tidak ada seasonality, tidak ada moving average, tidak ada growth rate yang konsisten.
2. **Rumus tidak seragam antar bulan.** Aturan order 1.5× cuma jalan di November (321 baris)
   dan sedikit di September (5 baris). Bulan lain manual.
3. **Dua definisi buffer** (1.5 bulan vs 30 hari) di dua tab yang dipakai bersamaan.
4. **`TOTAL` di Summary salah range** (`SUM(J:M)` = Sep–Des saja).
5. **Tidak ada lead time.** Incoming diasumsikan datang di bulan yang sama dengan
   saat dibutuhkan. Untuk produksi CMT/FOB ini tidak realistis.
6. **Tidak ada level ukuran/size.** Padahal ada tab `Size Availability` terpisah —
   artinya mereka butuh, tapi belum nyambung ke model.
7. **Rapuh secara teknis.** `NOW()`/`TODAY()` bikin angka berubah tiap dibuka;
   VLOOKUP by nama artikel (string) gampang putus kalau ada typo.

---

## 8. Selisih dengan yang sudah kita bangun

Skema kita sekarang (`supabase/migrations/20260716000001_planning_schema.sql`):

```sql
forecasts       (kind: sales|ops, period: 'YYYY-Qn')
forecast_lines  (style_id, qty, ito, stock_ratio)   -- ito & stock_ratio diisi MANUAL
```

| Aspek | Sheet client | Punya kita | Dampak |
|---|---|---|---|
| Granularity | **SKU** (683 baris) | `style_id` | kita tidak bisa hitung stok per varian/ukuran |
| Periode | **Bulanan**, 12 bucket | **Kuartalan**, 1 angka | tidak bisa jadi rencana beli/produksi |
| Stock roll | ada penuh (beginning/incoming/sales/ending) | **tidak ada** | inti modelnya justru belum ada |
| Rencana incoming | ada, dengan aturan 1.5× | tidak ada | tidak bisa keluar usulan order |
| Valuasi | qty × COGS dan qty × Retail | tidak ada | tidak bisa keluar Summary/P&L |
| ITO / Stock Ratio | **diturunkan dari data** | **kolom input manual** | angka tidak bisa dipercaya |
| Segmentasi Status Product | ada (`REGULAR`/`ESSENTIAL+`/dst) | tidak ada | tidak bisa keputusan lanjut/stop produk |

Kesimpulan: yang kita bangun baru menampung **niat forecast**, sedangkan yang client
pakai adalah **mesin proyeksi persediaan**. Bagian tersulit dan paling berharga —
stock roll bulanan per SKU + aturan replenishment — belum ada.

---

## 9. Yang sudah dibangun

Migration `supabase/migrations/20260719000001_projection_engine.sql` (sudah diterapkan),
tes `supabase/tests/projection.test.sql` (7 kasus, lolos).

| Objek | Fungsi |
|---|---|
| `planning_params` | asumsi per tenant: `cover_months` 1.5, `selling_days` 27, `net_rate` 0.95, `lead_time_months` 2 |
| `demand_plan` | **satu-satunya input manual**: forecast Sales QTY per SKU per bulan |
| `set_planning_params()` | ubah asumsi — **Owner saja** |
| `set_demand_plan()` | isi/ubah forecast — Sales & Owner |
| `seed_demand_plan()` | isi otomatis dari run-rate penjualan aktual; baris yang sudah disentuh manusia tidak ditimpa |
| `project_stock()` | mesin utamanya — setara blok 14 kolom/bulan di sheet |
| `projection_summary()` | setara tab `Summary`: Stock Ratio, ITO, GPM, Margin, ROI per bulan |

Aturannya persis sheet, tapi angkanya jadi parameter:

```
incoming  = max(0, ceil(sales × cover_months) − stok akhir bulan lalu)
beginning = stok akhir bulan lalu + incoming
ending    = beginning − sales
```

Stok awal bulan pertama diambil dari `stock_balances` (saldo `stock_ledger` sungguhan),
bukan angka ketikan. Semua nilai rupiah dihitung dari `skus.cogs` / `skus.retail_price`.

### Lead time

`supabase/migrations/20260719000002_lead_time.sql`. Sheet client tidak punya konsep ini —
barang diasumsikan datang di bulan yang sama dengan saat dibutuhkan.

Roll stoknya **tidak diubah sama sekali**; yang ditambah hanya satu turunan:

```
order_month = bulan kedatangan − lead_time_months
```

Halaman menampilkannya sebagai kolom **Pesan Bulan**, dengan tiga keadaan:
`Sekarang` (harus dipesan bulan ini), `Telat · <bulan>` (waktu pesannya sudah lewat,
kedatangan tidak lagi terkejar), atau nama bulan biasa. Jumlah yang telat dan yang
harus dipesan bulan ini muncul sebagai peringatan di atas halaman.

Default 2 bulan adalah **tebakan awal, bukan dari spreadsheet** — ditandai eksplisit
di layar supaya tidak dikira angka resmi.

### Barang yang sedang jalan + usulan jadi order

`supabase/migrations/20260719000003_committed_supply.sql`.

Begitu order produksi dibuat, stok belum bertambah (barang belum diterima). Tanpa
penanganan khusus, bulan berikutnya sistem akan menyuruh memesan barang yang sama
lagi — double order. Karena itu `incoming_qty` dipecah:

| Kolom | Arti |
|---|---|
| `committed_qty` | sudah dipesan, tinggal ditunggu (`prod_lines.qty_ordered − qty_received`, hanya PO yang belum `completed`/`canceled`) |
| `suggested_qty` | kekurangan yang masih harus dipesan |
| `incoming_qty` | total datang bulan itu = committed + suggested |

```
suggested = max(0, ceil(sales × cover) − stok akhir bulan lalu − committed)
```

Bagian yang sudah diterima tidak dihitung di sini karena sudah masuk `stock_ledger`,
jadi tidak ada dobel. PO tanpa deadline atau yang deadline-nya sudah lewat
dimasukkan ke bulan pertama horizon — barangnya nyata sedang dibuat, menyembunyikannya
justru bikin over-order.

Di layar: kolom **Sudah Dipesan** dan **Usulan Order** terpisah, plus panel
**Buat Order Produksi** yang mengelompokkan usulan per style dan memanggil
`create_production_order` yang sudah ada (satu order = satu style, deadline = akhir
bulan kedatangan). Setelah order dibuat, usulannya hilang dengan sendirinya.

Rantainya jadi tertutup:
`forecast → proyeksi → order produksi → terima barang → stok → jadi aktual berikutnya`.

### MOQ vendor

`supabase/migrations/20260721000001_vendor_moq.sql` — kolom `vendors.moq`
(unit per order, boleh kosong). Diisi lewat form Vendor.

Dicek di panel Buat Order Produksi: kalau total usulan satu style di bawah MOQ
vendor terpilih, tombolnya terkunci dengan alasan yang terlihat ("gabungkan
beberapa bulan atau pesan manual"). Sengaja **tidak** dipaksakan di
`create_production_order` — MOQ itu aturan dagang hasil nego, bukan integritas
data; order manual (mis. repeat order kecil yang disepakati vendor) harus tetap
bisa.

**Belum dikerjakan:**
1. Konfirmasi ke client: angka 27, 1.5, 95%, lead time, dan bentrok 30 hari vs 1.5 bulan.
2. Lead time masih satu angka untuk semua produk. Kaus dan outerwear jelas beda;
   idealnya per style atau per vendor.
3. Pembulatan qty per ukuran (size curve) belum ada — qty usulan apa adanya.
4. Tabel lama `forecasts`/`forecast_lines` (style per kuartal) dibiarkan apa adanya —
   masih dipakai alur alignment Sales-vs-Ops. Perlu diputuskan apakah dilebur.
