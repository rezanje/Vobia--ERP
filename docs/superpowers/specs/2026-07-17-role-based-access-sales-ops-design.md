# Role-Based Access: Sales vs Ops (demo simulation)

**Date:** 2026-07-17
**Goal:** Simulasi realistis 2 akun terpisah (Sales, Ops) buat demo klien — tiap akun cuma bisa akses menu & tulis data sesuai perannya, ditegakkan di DB (bukan cuma UI).
**Depth:** Implementasi + testing malam ini terbatas ke 5 modul baru (Forecast, Proyeksi, Produk Baru, PCB, PPO). Modul lama (HR/Keuangan/Produksi/dll) TIDAK disentuh — matriks aksesnya didesain penuh sebagai acuan, tapi eksekusi ditunda ke sesi lain.

## Konteks

User minta simulasi 2 akun (Sales POV, Ops POV) yang gak bisa saling akses menu/data satu sama lain. Investigasi: `profiles.role` udah ada enum (`owner,ops,production,inventory,finance,viewer`, belum ada `sales`), JWT claim `user_role` udah jalan (`custom_access_token_hook`), tapi middleware sekarang gak ngecek role sama sekali — semua user tenant sama liat semua menu. Pola existing buat role check: `src/lib/auth/role.ts` (`getRole()` + `canApprove()`), dipanggil per-halaman (server component), diteruskan sebagai prop boolean ke client component (`DocActions`) — bukan middleware global. Signup selalu bikin tenant baru (gak cocok buat bikin teammate di tenant yang sama).

Fungsi SQL P1-P3: `create_forecast`, `create_projection`, `create_pcb`, `create_ppo`, `issue_ppo_pos` = `security invoker` (RLS + fn-internal check jalan sesuai user pemanggil). `lock_projection` = `security definer` (BYPASS RLS user — wajib cek role manual di dalam fn). `new_products` dan `po_payments` ditulis langsung via `.from().insert()/.update()` di server actions (bukan lewat fn) — butuh RLS write-policy eksplisit.

## Role & Menu Matrix (visi penuh, acuan jangka panjang)

| Modul | owner | sales | ops | production | inventory | finance | viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Forecast (baris Sales) | ✅ | ✅ tulis | 👁 | ❌ | ❌ | ❌ | ❌ |
| Forecast (baris Ops) | ✅ | 👁 | ✅ tulis | ❌ | ❌ | ❌ | ❌ |
| Proyeksi (alignment+lock) | ✅ | 👁 | ✅ tulis | ❌ | ❌ | ❌ | ❌ |
| Produk Baru | ✅ | 👁 | ✅ tulis | ❌ | ❌ | ❌ | ❌ |
| PCB | ✅ | ❌ | ✅ tulis | ❌ | 👁 | 👁 | ❌ |
| PPO | ✅ | ❌ | ✅ tulis | ❌ | 👁 | 👁 | ❌ |
| Styles/Stok/Bahan/HPP | ✅ | ❌ | 👁 | ✅ tulis | ✅ tulis | 👁 | ❌ |
| Produksi/Vendor | ✅ | ❌ | 👁 | ✅ tulis | ❌ | ❌ | ❌ |
| Order/Channel/Retur | ✅ | ✅ tulis | 👁 | ❌ | ❌ | 👁 | ❌ |
| Pembelian/Stok Bahan | ✅ | ❌ | ✅ tulis | ❌ | ✅ tulis | 👁 | ❌ |
| Keuangan | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ tulis | ❌ |
| HR/Payroll | ✅ | ❌ | ❌ | ❌ | ❌ | 👁 | ❌ |
| Lokasi | ✅ | ❌ | ✅ tulis | ❌ | 👁 | ❌ | ❌ |

**Digarap malam ini:** baris Forecast, Proyeksi, Produk Baru, PCB, PPO — kolom `owner`, `sales`, `ops` full ditegakkan (UI + DB). Baris lain: matriks jadi dokumentasi acuan, TIDAK ada perubahan kode.

## Perubahan schema

- `profiles.role` check constraint: tambah `'sales'`.
- Tidak ada tabel baru.

## Dua akun demo

Script baru `scripts/seed-users.mjs` (pola sama `seed-demo.mjs`: `pg.Client` connect via `SUPABASE_DB_URL`, jalan sebagai postgres, bypass RLS):
1. Insert ke `auth.users` langsung (email, `encrypted_password` via `crypt(password, gen_salt('bf'))` — ekstensi `pgcrypto`, sudah aktif karena dipakai `gen_random_uuid()` di seluruh migrasi — field wajib GoTrue: `instance_id`, `aud='authenticated'`, `role='authenticated'`, `email_confirmed_at=now()`, `raw_app_meta_data`, `raw_user_meta_data`).
2. Trigger `handle_new_user()` otomatis jalan → bikin tenant BARU + profile role=`owner`. Script langsung fix: `update profiles set tenant_id=<tenant superadmin>, role=<sales|ops> where id=<user baru>`, lalu `delete from tenants where id=<tenant nyasar>`.
3. Akun: `sales.demo@vobia.test` (role `sales`) dan `ops.demo@vobia.test` (role `ops`), password sama kayak dipakai superadmin (`password123`), tenant = tenant `superadmin@vobia.com` (biar data seed P1-P3 kebuka).
4. Idempotent: kalau user udah ada (by email), update profile aja, jangan bikin auth user baru.

## Penegakan DB (bukan cuma UI)

Prinsip: semua tulis ke 5 modul ini lewat SATU pintu (fungsi SQL atau 1 server action) — cek role di titik itu. `raise exception` pesan Bahasa Indonesia jelas kalau ditolak, biar UI bisa tampilin pesan yang manusiawi (bukan error Postgres mentah).

| Fungsi/tabel | Tipe | Aturan |
|---|---|---|
| `create_forecast(p_kind,...)` | fn (invoker) | `p_kind='sales'` → role harus `owner`/`sales`. `p_kind='ops'` → role harus `owner`/`ops`. Cek pakai `(auth.jwt()->>'user_role')`. |
| `create_projection` | fn (invoker) | role harus `owner`/`ops`. |
| `lock_projection` | fn (**definer** — WAJIB cek manual, RLS gak jalan otomatis) | role harus `owner`/`ops`. |
| `create_pcb` | fn (invoker) | role harus `owner`/`ops`. |
| `create_ppo` | fn (invoker) | role harus `owner`/`ops`. |
| `issue_ppo_pos` | fn (invoker) | role harus `owner`/`ops`. (Tabel `purchase_orders`/`purchase_lines` yang ditulisnya TIDAK diberi RLS role-restriction baru — itu tabel lama dipakai alur Pembelian existing, restriksi cukup di titik masuk fn ini.) |
| `new_products` (insert/update) | RLS write-policy baru | role harus `owner`/`ops`. Read tetap tenant_isolation biasa (sales boleh liat). |
| `po_payments` (insert/update) | RLS write-policy baru | role harus `owner`/`ops`. |
| `pcb`, `pcb_lines`, `ppo` (SELECT) | RLS read-policy dipersempit | role harus `owner`/`ops` (sales gak bisa select sama sekali — cocok ❌ di matriks). Ganti policy `tenant_isolation` yang for-all jadi: policy SELECT terpisah role-gated + policy INSERT/UPDATE/DELETE terpisah role-gated (menggantikan for-all lama, tenant check tetap ada di semua). |
| `forecasts`,`forecast_lines`,`projections`,`projection_lines` (SELECT) | RLS read-policy dipersempit | role harus `owner`/`sales`/`ops` (production/inventory/finance/viewer belum dibikin akunnya malam ini — gak masalah dibatasi juga, gak ada regresi karena gak ada yang pakai role itu sekarang). |

Cara ubah policy for-all existing jadi split read/write: `drop policy tenant_isolation`, ganti 2 policy baru per tabel (`select` + `all_write` mencakup insert/update/delete), tenant check tetap di keduanya.

## Penegakan UI

- `SideNav.tsx`: terima prop `role: string`. Struktur `GROUPS`/item ditambah field opsional `roles?: string[]` — kalau diisi, item cuma keliatan kalau role user ada di situ; kalau kosong, keliatan semua (default, gak ganggu menu existing). Isi buat 5 modul baru: Forecast/Proyeksi/Produk Baru = `['owner','sales','ops']`, PCB/PPO = `['owner','ops']`.
- `AppShell.tsx`: jadi async server component, panggil `getRole()`, teruskan ke `<SideNav role={role}/>`.
- Tiap 5 halaman (forecasts, projections, projections/[id], new-products, pcb*, ppo*) tambah `getRole()` di atas (pola sama `purchasing/[id]/page.tsx`):
  - PCB/PPO (semua sub-route): kalau role bukan `owner`/`ops` → `redirect('/')`.
  - Forecast/Proyeksi/Produk Baru: semua role (`owner`,`sales`,`ops`) boleh buka, tapi form/tombol tulis (ForecastForm buat kind yang bukan haknya, AlignmentForm submit, LockButton, NewProductForm/Row edit) disembunyiin/nonaktif kalau role gak berhak — pola sama `canApprove` boolean prop ke `DocActions`.
  - `ForecastForm`: kalau role `sales` → dropdown Jenis dikunci ke `sales` (gak bisa pilih ops), kalau `ops` → dikunci ke `ops`, kalau `owner` → bebas pilih (pola sama `IssueForm` yang ngunci `po_type` pas FOB).

## Testing

pgTAP baru `supabase/tests/role_access.test.sql`: set JWT `user_role='sales'` → assert `create_forecast(kind='ops',...)` raise exception, `create_pcb(...)` raise exception; assert `create_forecast(kind='sales',...)` sukses. Ulang buat `user_role='ops'` (kebalikannya) dan `owner` (semua sukses). Assert SELECT pcb/ppo kosong buat sales walau ada barisnya (RLS read block).

Manual: login 2 akun di browser, screenshot menu beda, coba akses `/pcb` langsung via URL sebagai sales → ke-redirect.

## Keputusan desain

- **Kenapa cek role di dalam fn, bukan RLS penuh di semua tabel:** semua tulis P1-P3 (kecuali new_products/po_payments) udah lewat 1 pintu fn — taruh cek di situ lebih simpel, pesan error lebih manusiawi, dan gak resiko salah setting RLS di tabel yang dipakai bareng alur lama (purchase_orders/purchase_lines).
- **Kenapa lock_projection butuh perhatian khusus:** `security definer` bikin RLS gak otomatis jalan buat fn ini — tanpa cek manual, sales bisa manggil `lock_projection` langsung via RPC walau UI nyembunyiin tombolnya.
- **Kenapa read-policy PCB/PPO dipersempit tapi Forecast/Proyeksi enggak (buat sales):** matriks: sales `👁` di Forecast/Proyeksi/Produk Baru (butuh liat buat alignment), tapi `❌` total di PCB/PPO (di luar scope kerjanya).
- **Password akun demo:** disamain manual pas seeding (bukan dikirim email), karena ini akun simulasi lokal buat presentasi, bukan akun produksi.
