# Design — Vobia ERP Sub-project 1: Foundation

**Status:** Approved (brainstorm)
**Tanggal:** 2026-07-01
**Related:** `vobia_erp_phase1_prd.md` §5.1, §8; `vobia_architecture_adr.md` §4.3
**Deciders:** GenDev Studio (Nje) × Vobia

## 1. Tujuan

Bangun fondasi ERP: repo Next.js + Supabase + multi-tenant RLS + auth, jalan end-to-end. **Belum ada modul bisnis** — hanya lapisan dasar yang menjamin isolasi tenant sejak baris pertama, plus template RLS yang dipakai ulang semua tabel berikutnya.

Non-goal: tabel product/stock/production/order apapun. Itu mulai di sub-project 2.

## 2. Konteks & keputusan kunci

- Multi-tenant via **RLS di database**, bukan filter app code (ADR §4.3). Alasan: bug app tidak boleh bisa bocorin data antar tenant.
- **Custom access token auth hook wajib.** `tenant_id` tidak masuk JWT otomatis. Tanpa hook, `auth.jwt() ->> 'tenant_id'` = null → RLS blokir semua / atau (worse) salah konfigurasi bocor. Hook ini bagian non-obvious yang ADR lewatkan.
- Pakai helper `auth.jwt()` (Supabase saat ini), bukan `current_setting('request.jwt.claims')` mentah.
- Next.js 15/16 (bukan 14 seperti ditulis ADR). App Router, TS, Tailwind, Turbopack default.

## 3. Arsitektur

```
Browser (Next.js App Router, TS, Tailwind)
   │  signup / login (supabase-js)
   ▼
Supabase Auth ──(custom access token hook)──> JWT { sub, tenant_id, role }
   │
   ▼
Postgres (RLS) : tenants, profiles
   policy: tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
```

Tidak ada API server terpisah. Auth pages = Server Components + Server Actions.

## 4. Skema

### 4.1 `tenants`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| name | text not null | |
| created_at | timestamptz default now() | |

### 4.2 `profiles`
| kolom | tipe | catatan |
|---|---|---|
| id | uuid pk | = auth.users.id (FK on delete cascade) |
| tenant_id | uuid not null | FK → tenants.id |
| role | text not null default 'viewer' | check in (`owner`,`ops`,`production`,`inventory`,`finance`,`viewer`) |
| full_name | text | |
| created_at | timestamptz default now() | |

Index: `profiles(tenant_id)`.

### 4.3 RLS
Enable RLS pada `tenants` dan `profiles`.

```sql
-- template yang dipakai ulang semua tabel ber-tenant_id
create policy tenant_isolation on profiles
  for all
  to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- tenants: user hanya lihat tenant miliknya
create policy own_tenant on tenants
  for select
  to authenticated
  using (id = (auth.jwt() ->> 'tenant_id')::uuid);

-- bootstrap: user selalu bisa baca profile-nya sendiri via auth.uid(),
-- meski tenant_id claim belum ada di JWT (token pertama sesudah signup).
-- Ini yang memutus chicken-egg antara "butuh claim untuk baca profiles"
-- vs "hook baca profiles untuk isi claim".
create policy self_read on profiles
  for select
  to authenticated
  using (id = (select auth.uid()));
```

Urutan evaluasi: policy `for select` bersifat OR — `self_read` (auth.uid) menang saat claim kosong; `tenant_isolation` menang untuk baca profile anggota tenant lain sesudah claim ada.

## 5. Custom access token auth hook

Fungsi Postgres dipanggil Supabase Auth tiap mint token. Baca `tenant_id` + `role` dari `profiles`, tambahkan ke claims.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare
  claims jsonb := event->'claims';
  p record;
begin
  select tenant_id, role into p
  from public.profiles
  where id = (event->>'user_id')::uuid;

  if p.tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(p.tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(p.role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;
```

Daftarkan hook di Supabase Auth config (dashboard / config.toml). Grant execute ke `supabase_auth_admin`, revoke dari publik.

> **Penting (gotcha):** app role masuk claim `user_role`, **bukan** `role`. Claim `role` dipakai PostgREST untuk `SET ROLE` (harus `authenticated`/`anon`); kalau ditimpa `owner` → `role "owner" does not exist` (401) di semua request data. Phase 2 yang butuh baca app-role dari JWT baca `user_role`.

## 6. Auth flow

1. **Signup** (Server Action): create auth user via supabase-js. Buat `tenants` row + `profiles` row (tenant_id baru, role `owner`) untuk user pertama tenant. (Invite user lain ke tenant existing = P1, di luar Foundation.)
2. Token pertama sesudah profile ada → hook inject `tenant_id`. Kalau signup dan profile dibuat dalam transaksi sebelum token mint, claim langsung ada. Kalau race, force refresh session sesudah profile insert.
3. **Login**: supabase-js sign in → JWT dengan claims → RLS aktif.
4. Session di-wire ke Server Components via supabase-js SSR client (cookies).

## 7. Units (isolated, testable)

1. **Migration** — tenants + profiles + RLS + policies. Test: pgTAP.
2. **Auth hook** — fungsi + registrasi. Test: mint token dua user beda tenant, assert claims benar.
3. **Codegen pipeline** — `supabase gen types typescript` → `src/types/database.ts`, script di package.json.
4. **Auth pages** — signup/login (Server Actions) + SSR session client.

## 8. Acceptance criteria

- Dua tenant di-seed (A, B), masing-masing satu user.
- Login user A → `select * from profiles` hanya return row tenant A. Idem B.
- **pgTAP:** set JWT claim tenant A, query profiles tenant B → 0 rows. Bukti isolasi di level DB, bukan app.
- `auth.jwt() ->> 'tenant_id'` non-null sesudah login (hook jalan).
- `npm run gen:types` hasilkan `database.ts` tanpa error.

## 9. Testing

- **pgTAP:** RLS isolation + hook claim injection.
- **Playwright:** signup → login → lihat dashboard kosong (flow kritis).
- Vitest: belum banyak logic murni di Foundation; tambah saat modul bisnis masuk.

## 10. Out of scope

- Invite/multi-user per tenant (P1).
- Role-based UI gating detail (cukup role di JWT dulu).
- Modul bisnis apapun.
- Migrasi/port screen prototype lama (hanya salvage styles.css sebagai referensi di sub-project UI nanti).
