# Fase A — Multi-Location Inventory + Material Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add physical-location tracking to the stock ledger (locations, transfers, opname) plus a raw-material catalog, without breaking any existing SKU-based inventory flow.

**Architecture:** New `locations` and `materials` master tables follow the existing multi-tenant + RLS pattern. `stock_ledger` gains a non-null `location_id` (backfilled to each tenant's default location). `record_movement()` gains an optional trailing `p_location_id` that defaults to the tenant's default location — so all existing callers keep working unchanged. A new `record_transfer()` writes a balanced `transfer_out`/`transfer_in` pair. Opname reuses the existing `adjustment` movement, posting only non-zero deltas per location. UI mirrors the existing vendor/stock pages.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase Postgres + RLS, plpgsql `security definer` functions, pgtap DB tests (`npm run test:db`), vitest unit tests, hand-written types in `src/types/database.ts`.

**Migration/test flow:** DB tests run against the remote DB via the pgtap harness (each test wrapped in a rollback). A migration must be applied **before** its test passes. Apply migrations with the project's push flow: `supabase db push` over the session pooler (env `SUPABASE_DB_URL` must be set; same var the harness uses). TDD order per DB task: write test → run (fails, object absent) → write migration → push → run (passes) → commit.

---

## File Structure

**Migrations (create):**
- `supabase/migrations/20260709000001_locations.sql` — locations table + seed default per tenant
- `supabase/migrations/20260709000002_materials.sql` — materials catalog
- `supabase/migrations/20260709000003_stock_location.sql` — add `location_id`, backfill, extend movement_type check, `stock_balances_by_location` view
- `supabase/migrations/20260709000004_record_movement_v2.sql` — replace `record_movement` with location param + new movement types
- `supabase/migrations/20260709000005_record_transfer.sql` — new `record_transfer` function

**DB tests (create):**
- `supabase/tests/locations.test.sql`
- `supabase/tests/materials.test.sql`
- `supabase/tests/stock_location.test.sql` (covers location_id backfill/default, transfer, view)

**Types (modify):**
- `src/types/database.ts` — add `locations`, `materials`, updated `stock_ledger`, `stock_balances_by_location` view, updated `record_movement` args, new `record_transfer` fn

**App code (create):**
- `src/lib/locations/actions.ts`
- `src/lib/materials/actions.ts`
- `src/lib/stock/opname.ts` + `src/lib/stock/opname.test.ts`
- `src/app/(app)/locations/page.tsx` + `LocationForm.tsx`
- `src/app/(app)/materials/page.tsx` + `MaterialForm.tsx`
- `src/app/(app)/stock/TransferForm.tsx` + `OpnameForm.tsx`

**App code (modify):**
- `src/lib/stock/actions.ts` — add `recordTransfer`, `postOpname`
- `src/app/(app)/stock/page.tsx` — per-location balances + mount transfer/opname forms
- `src/components/SideNav.tsx` — add Bahan + Lokasi nav
- `src/lib/ui.ts` — add transfer badge meta

---

## Task 1: `locations` table

**Files:**
- Create: `supabase/migrations/20260709000001_locations.sql`
- Test: `supabase/tests/locations.test.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/locations.test.sql`:

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('a1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','loc@s.test','{"tenant_name":"Loc Co"}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('a2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','loc2@s.test','{"tenant_name":"Loc Other"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='a1111111-1111-1111-1111-111111111111');
  v_other  uuid := (select tenant_id from public.profiles where id='a2222222-2222-2222-2222-222222222222');
  v_cnt int;
begin
  -- new-user hook seeded exactly one default location per tenant
  select count(*) into v_cnt from public.locations where tenant_id = v_tenant and is_default;
  if v_cnt <> 1 then raise exception 'expected 1 default location for tenant, got %', v_cnt; end if;

  -- RLS: acting as tenant A cannot see tenant B's locations
  perform set_config('request.jwt.claims',
    json_build_object('sub','a1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);
  if exists (select 1 from public.locations where tenant_id = v_other) then
    raise exception 'RLS leak: tenant A sees tenant B locations';
  end if;

  -- can insert own-tenant location
  insert into public.locations (name) values ('Toko Bandung');
  reset role;
  raise notice 'locations OK: default seeded, RLS isolated, insert works';
end $$;

rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db supabase/tests/locations.test.sql`
Expected: FAIL / ERROR — `relation "public.locations" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260709000001_locations.sql`:

```sql
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  name text not null,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
-- at most one default per tenant
create unique index locations_one_default on public.locations(tenant_id) where is_default;

alter table public.locations enable row level security;
create policy tenant_isolation on public.locations for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.locations to authenticated;

-- seed default location for every existing tenant
insert into public.locations (tenant_id, name, is_default)
select id, 'Gudang Utama', true from public.tenants
on conflict (tenant_id, name) do nothing;
```

- [ ] **Step 4: Extend the new-user hook to seed a default location for new tenants**

The test asserts every tenant has a default location. New tenants are created by the `handle_new_user` trigger (see `supabase/migrations/20260701000002_new_user.sql`). Add a location insert there so future tenants are covered too. Append to the migration file `20260709000001_locations.sql`:

```sql
-- extend new-user handler to seed a default location alongside the tenant.
-- Read the current body from 20260701000002_new_user.sql and re-declare it with
-- one added insert after the tenant/profile rows are created:
--
--   insert into public.locations (tenant_id, name, is_default)
--   values (v_tenant_id, 'Gudang Utama', true);
--
-- Use the SAME function name and signature as the existing handler so the
-- trigger keeps pointing at it (create or replace function ...).
```

Open `supabase/migrations/20260701000002_new_user.sql`, copy its `create or replace function` block verbatim into this migration, and insert the `locations` row using whatever variable that function already uses for the new tenant id. Keep everything else identical.

- [ ] **Step 5: Apply the migration**

Run: `supabase db push`
Expected: migration `20260709000001_locations` applied, no errors.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:db supabase/tests/locations.test.sql`
Expected: `RESULT: PASS`, notice `locations OK: default seeded, RLS isolated, insert works`.

- [ ] **Step 7: Add the type**

In `src/types/database.ts`, inside `Tables`, after the `skus` entry add:

```ts
      locations: {
        Row: { id: string; tenant_id: string; name: string; is_default: boolean; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; is_default?: boolean; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; is_default?: boolean; active?: boolean; created_at?: string }
        Relationships: []
      }
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260709000001_locations.sql supabase/tests/locations.test.sql src/types/database.ts
git commit -m "feat: locations master + per-tenant default seed"
```

---

## Task 2: `materials` catalog

**Files:**
- Create: `supabase/migrations/20260709000002_materials.sql`
- Test: `supabase/tests/materials.test.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/materials.test.sql`:

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('b1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','mat@s.test','{"tenant_name":"Mat Co"}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('b2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','mat2@s.test','{"tenant_name":"Mat Other"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='b1111111-1111-1111-1111-111111111111');
  v_other  uuid := (select tenant_id from public.profiles where id='b2222222-2222-2222-2222-222222222222');
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.materials (code, name, category, uom) values ('FAB-001','Katun Combed 30s','fabric','m');

  -- category check rejects garbage
  begin
    insert into public.materials (code, name, category, uom) values ('X','Bad','nonsense','m');
    raise exception 'CATEGORY_SHOULD_FAIL';
  exception when check_violation then null;
  end;

  reset role;
  -- RLS: other tenant cannot see it
  if exists (
    select 1 from public.materials m where m.code = 'FAB-001' and m.tenant_id = v_other
  ) then raise exception 'RLS leak on materials'; end if;

  raise notice 'materials OK: insert, category check, RLS';
end $$;

rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db supabase/tests/materials.test.sql`
Expected: FAIL — `relation "public.materials" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260709000002_materials.sql`:

```sql
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  name text not null,
  category text not null check (category in ('fabric','trim','accessory','other')),
  uom text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

alter table public.materials enable row level security;
create policy tenant_isolation on public.materials for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.materials to authenticated;
```

- [ ] **Step 4: Apply the migration**

Run: `supabase db push`
Expected: `20260709000002_materials` applied.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:db supabase/tests/materials.test.sql`
Expected: `RESULT: PASS`.

- [ ] **Step 6: Add the type**

In `src/types/database.ts`, after the `locations` entry add:

```ts
      materials: {
        Row: { id: string; tenant_id: string; code: string; name: string; category: string; uom: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; name: string; category: string; uom: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; name?: string; category?: string; uom?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
```

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add supabase/migrations/20260709000002_materials.sql supabase/tests/materials.test.sql src/types/database.ts
git commit -m "feat: materials catalog table"
```

---

## Task 3: `stock_ledger` location column + view

**Files:**
- Create: `supabase/migrations/20260709000003_stock_location.sql`
- Test: `supabase/tests/stock_location.test.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/stock_location.test.sql` (this file grows in Tasks 4 & 5; start with the column + view checks):

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('c1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','stl@s.test','{"tenant_name":"Stl Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='c1111111-1111-1111-1111-111111111111');
  v_loc uuid;
  v_style uuid; v_sku uuid; v_bal int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','c1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  v_style := public.create_style_with_skus('STL-1','Stl','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;

  -- movement with no location lands in default location (record_movement v2, Task 4)
  perform public.record_movement(v_sku, 10, 'production_in');
  select balance into v_bal from public.stock_balances_by_location
    where sku_id = v_sku and location_id = v_loc;
  if v_bal <> 10 then raise exception 'expected 10 at default location, got %', v_bal; end if;

  raise notice 'stock_location OK: default location balance view works';
end $$;

rollback;
```

> Note: this test also exercises `record_movement` v2 (Task 4). It will fully pass only after Task 4 is applied. In this task, run it to confirm the *view and column* exist (the `record_movement` call will still route to default once Task 4 lands). If you are doing strict per-task green, run only the column existence portion now and the full file after Task 4. Simplest path: apply Task 3 then Task 4 back-to-back, then green this file once.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db supabase/tests/stock_location.test.sql`
Expected: FAIL — `column "location_id" ... does not exist` or `relation "stock_balances_by_location" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260709000003_stock_location.sql`:

```sql
-- 1. add location_id (nullable first so existing rows survive)
alter table public.stock_ledger add column location_id uuid references public.locations(id);

-- 2. backfill every existing row to its tenant's default location
update public.stock_ledger sl
set location_id = (
  select l.id from public.locations l
  where l.tenant_id = sl.tenant_id and l.is_default
  limit 1
)
where location_id is null;

-- 3. now enforce not-null
alter table public.stock_ledger alter column location_id set not null;
create index stock_ledger_location_idx on public.stock_ledger(location_id);

-- 4. allow transfer movement types
alter table public.stock_ledger drop constraint stock_ledger_movement_type_check;
alter table public.stock_ledger add constraint stock_ledger_movement_type_check
  check (movement_type in
    ('production_in','sale_out','return_in','adjustment','transfer_in','transfer_out'));

-- 5. per-location balance view (total-per-sku view stays untouched)
create view public.stock_balances_by_location with (security_invoker = on) as
select sku_id, location_id, tenant_id, sum(qty)::int as balance
from public.stock_ledger
group by sku_id, location_id, tenant_id;

grant select on public.stock_balances_by_location to authenticated;
```

> Verify the constraint name first: `stock_ledger` was created with an inline unnamed `check (movement_type in (...))`, which Postgres auto-names `stock_ledger_movement_type_check`. If `supabase db push` errors that the constraint does not exist, find the real name with `\d public.stock_ledger` (or `select conname from pg_constraint where conrelid = 'public.stock_ledger'::regclass and contype='c';`) and substitute it.

- [ ] **Step 4: Apply the migration**

Run: `supabase db push`
Expected: `20260709000003_stock_location` applied. (Do Task 4 before greening the test — see Step 1 note.)

- [ ] **Step 5: Update the types**

In `src/types/database.ts`, replace the `stock_ledger` entry's three lines to add `location_id`:

```ts
      stock_ledger: {
        Row: { id: string; tenant_id: string; sku_id: string; location_id: string; qty: number; movement_type: string; reason: string | null; ref_type: string | null; ref_id: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; sku_id: string; location_id: string; qty: number; movement_type: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; sku_id?: string; location_id?: string; qty?: number; movement_type?: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
```

Then inside `Views`, after `stock_balances`, add:

```ts
      stock_balances_by_location: {
        Row: { sku_id: string | null; location_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
```

- [ ] **Step 6: Commit** (green the shared test after Task 4)

```bash
git add supabase/migrations/20260709000003_stock_location.sql supabase/tests/stock_location.test.sql src/types/database.ts
git commit -m "feat: stock_ledger location_id + per-location balance view"
```

---

## Task 4: `record_movement` v2 (location param + transfer signs)

**Files:**
- Create: `supabase/migrations/20260709000004_record_movement_v2.sql`
- Modify: `supabase/tests/stock_location.test.sql` (add default-vs-explicit location cases), `src/types/database.ts`

- [ ] **Step 1: Add failing assertions to the shared test**

Append inside the `do $$ ... end $$;` block of `supabase/tests/stock_location.test.sql`, just before the final `raise notice`:

```sql
  -- explicit location routes there, not to default
  declare v_loc2 uuid; v_bal2 int;
  begin
    insert into public.locations (name) values ('Toko Kedua') returning id into v_loc2;
    perform public.record_movement(v_sku, 4, 'production_in', null, null, null, v_loc2);
    select balance into v_bal2 from public.stock_balances_by_location
      where sku_id = v_sku and location_id = v_loc2;
    if v_bal2 <> 4 then raise exception 'expected 4 at Toko Kedua, got %', v_bal2; end if;

    -- default location still holds the original 10
    select balance into v_bal from public.stock_balances_by_location
      where sku_id = v_sku and location_id = v_loc;
    if v_bal <> 10 then raise exception 'expected 10 still at default, got %', v_bal; end if;
  end;

  -- cross-tenant location is rejected
  declare v_foreign_loc uuid;
  begin
    perform set_config('role', null, true); reset role;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      values ('c9999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-000000000000',
              'authenticated','authenticated','stlx@s.test','{"tenant_name":"Stl X"}');
    select id into v_foreign_loc from public.locations
      where tenant_id = (select tenant_id from public.profiles where id='c9999999-9999-9999-9999-999999999999')
        and is_default;
    perform set_config('request.jwt.claims',
      json_build_object('sub','c1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
    perform set_config('role','authenticated', true);
    begin
      perform public.record_movement(v_sku, 1, 'production_in', null, null, null, v_foreign_loc);
      raise exception 'FOREIGN_LOC_SHOULD_FAIL';
    exception when others then
      if sqlerrm not like '%another tenant%' then raise; end if;
    end;
  end;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db supabase/tests/stock_location.test.sql`
Expected: FAIL — `function public.record_movement(..., uuid) does not exist` (the 7-arg form isn't defined yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260709000004_record_movement_v2.sql`:

```sql
create or replace function public.record_movement(
  p_sku_id uuid,
  p_qty integer,
  p_movement_type text,
  p_reason text default null,
  p_ref_type text default null,
  p_ref_id uuid default null,
  p_location_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_sku_tenant uuid;
  v_loc_tenant uuid;
  v_location uuid;
  v_qty integer;
  v_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_qty = 0 then raise exception 'qty must be non-zero'; end if;
  if p_movement_type not in
     ('production_in','sale_out','return_in','adjustment','transfer_in','transfer_out') then
    raise exception 'invalid movement_type: %', p_movement_type;
  end if;

  select tenant_id into v_sku_tenant from public.skus where id = p_sku_id;
  if v_sku_tenant is null then raise exception 'sku not found'; end if;
  if v_sku_tenant <> v_tenant then raise exception 'sku belongs to another tenant'; end if;

  -- resolve location: explicit (validated) or tenant default
  if p_location_id is null then
    select id into v_location from public.locations
      where tenant_id = v_tenant and is_default limit 1;
    if v_location is null then raise exception 'no default location for tenant'; end if;
  else
    select tenant_id into v_loc_tenant from public.locations where id = p_location_id;
    if v_loc_tenant is null then raise exception 'location not found'; end if;
    if v_loc_tenant <> v_tenant then raise exception 'location belongs to another tenant'; end if;
    v_location := p_location_id;
  end if;

  if p_movement_type = 'adjustment' then
    if p_reason is null or trim(p_reason) = '' then
      raise exception 'adjustment requires a reason';
    end if;
    v_qty := p_qty;
  elsif p_movement_type in ('sale_out','transfer_out') then
    v_qty := -abs(p_qty);
  else
    v_qty := abs(p_qty);  -- production_in, return_in, transfer_in
  end if;

  insert into public.stock_ledger
    (tenant_id, sku_id, location_id, qty, movement_type, reason, ref_type, ref_id, created_by)
  values
    (v_tenant, p_sku_id, v_location, v_qty, p_movement_type, p_reason, p_ref_type, p_ref_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function
  public.record_movement(uuid, integer, text, text, text, uuid, uuid) to authenticated;
```

> The old 6-arg signature is a *different* function overload. Drop it so callers can't accidentally bind the pre-location version:
> ```sql
> drop function if exists public.record_movement(uuid, integer, text, text, text, uuid);
> ```
> Add that `drop` line at the TOP of this migration, before the `create or replace`.

- [ ] **Step 4: Apply the migration**

Run: `supabase db push`
Expected: `20260709000004_record_movement_v2` applied.

- [ ] **Step 5: Run the shared test to verify it passes**

Run: `npm run test:db supabase/tests/stock_location.test.sql`
Expected: `RESULT: PASS`, notice `stock_location OK`.

- [ ] **Step 6: Run the existing regression DB test**

Run: `npm run test:db supabase/tests/stock_ledger.test.sql`
Expected: `RESULT: PASS` — the old 3-arg / 4-arg calls (`record_movement(v_sku, 10, 'production_in')`) still work because the new params default. If this fails, the default-location resolution or the dropped-overload step is wrong; fix before continuing.

- [ ] **Step 7: Update the type**

In `src/types/database.ts`, replace the `record_movement` function entry:

```ts
      record_movement: {
        Args: { p_sku_id: string; p_qty: number; p_movement_type: string; p_reason?: string; p_ref_type?: string; p_ref_id?: string; p_location_id?: string }
        Returns: string
      }
```

- [ ] **Step 8: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add supabase/migrations/20260709000004_record_movement_v2.sql supabase/tests/stock_location.test.sql src/types/database.ts
git commit -m "feat: record_movement location param + transfer movement signs"
```

---

## Task 5: `record_transfer` function

**Files:**
- Create: `supabase/migrations/20260709000005_record_transfer.sql`
- Modify: `supabase/tests/stock_location.test.sql`, `src/types/database.ts`

- [ ] **Step 1: Add failing assertions to the shared test**

Append inside the `do $$ ... end $$;` block of `supabase/tests/stock_location.test.sql`, before the final `raise notice`. (At this point default location holds 10, `Toko Kedua` holds 4.)

```sql
  -- transfer 6 from default to Toko Kedua conserves the total (14)
  declare v_total_before int; v_total_after int;
  begin
    select coalesce(sum(qty),0) into v_total_before from public.stock_ledger where sku_id = v_sku;
    perform public.record_transfer(v_sku, 6, v_loc, v_loc2, 'pindah toko');
    select coalesce(sum(qty),0) into v_total_after from public.stock_ledger where sku_id = v_sku;
    if v_total_before <> v_total_after then
      raise exception 'transfer changed total: % -> %', v_total_before, v_total_after;
    end if;
    -- default now 4, Toko Kedua now 10
    if (select balance from public.stock_balances_by_location where sku_id=v_sku and location_id=v_loc) <> 4
      then raise exception 'expected 4 at default after transfer'; end if;
    if (select balance from public.stock_balances_by_location where sku_id=v_sku and location_id=v_loc2) <> 10
      then raise exception 'expected 10 at Toko Kedua after transfer'; end if;
  end;

  -- overdraw is rejected (default has 4, ask for 999)
  begin
    perform public.record_transfer(v_sku, 999, v_loc, v_loc2, 'x');
    raise exception 'OVERDRAW_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%insufficient%' then raise; end if;
  end;

  -- from == to is rejected
  begin
    perform public.record_transfer(v_sku, 1, v_loc, v_loc, 'x');
    raise exception 'SAME_LOC_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%differ%' then raise; end if;
  end;
```

> `v_loc2` was declared in the Task 4 append block. If your assembled test scopes it inside a nested `begin/end`, hoist `v_loc2 uuid;` into the outer `declare` so these blocks can see it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db supabase/tests/stock_location.test.sql`
Expected: FAIL — `function public.record_transfer(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260709000005_record_transfer.sql`:

```sql
create or replace function public.record_transfer(
  p_sku_id uuid,
  p_qty integer,
  p_from_location uuid,
  p_to_location uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_bal integer;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_qty <= 0 then raise exception 'transfer qty must be positive'; end if;
  if p_from_location = p_to_location then raise exception 'from and to must differ'; end if;

  if not exists (select 1 from public.locations where id = p_from_location and tenant_id = v_tenant) then
    raise exception 'from location not found for tenant';
  end if;
  if not exists (select 1 from public.locations where id = p_to_location and tenant_id = v_tenant) then
    raise exception 'to location not found for tenant';
  end if;
  if not exists (select 1 from public.skus where id = p_sku_id and tenant_id = v_tenant) then
    raise exception 'sku belongs to another tenant';
  end if;

  select coalesce(sum(qty), 0) into v_bal from public.stock_ledger
    where sku_id = p_sku_id and location_id = p_from_location;
  if v_bal < p_qty then
    raise exception 'insufficient balance at source: have %, need %', v_bal, p_qty;
  end if;

  perform public.record_movement(p_sku_id, p_qty, 'transfer_out',
    coalesce(p_reason, 'transfer'), 'transfer', null, p_from_location);
  perform public.record_movement(p_sku_id, p_qty, 'transfer_in',
    coalesce(p_reason, 'transfer'), 'transfer', null, p_to_location);
end;
$$;

grant execute on function
  public.record_transfer(uuid, integer, uuid, uuid, text) to authenticated;
```

- [ ] **Step 4: Apply + green + commit**

```bash
supabase db push
npm run test:db supabase/tests/stock_location.test.sql   # expect RESULT: PASS
```

Add the type in `src/types/database.ts` `Functions` (after `record_movement`):

```ts
      record_transfer: {
        Args: { p_sku_id: string; p_qty: number; p_from_location: string; p_to_location: string; p_reason?: string }
        Returns: undefined
      }
```

Run `npx tsc --noEmit` (expect no errors), then:

```bash
git add supabase/migrations/20260709000005_record_transfer.sql supabase/tests/stock_location.test.sql src/types/database.ts
git commit -m "feat: record_transfer balanced pair with overdraw guard"
```

---

## Task 6: Opname delta logic (pure) + vitest

**Files:**
- Create: `src/lib/stock/opname.ts`, `src/lib/stock/opname.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/stock/opname.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeOpnameDeltas } from './opname'

describe('computeOpnameDeltas', () => {
  it('returns counted minus balance for changed skus only', () => {
    const balances = [
      { sku_id: 'a', balance: 10 },
      { sku_id: 'b', balance: 5 },
      { sku_id: 'c', balance: 0 },
    ]
    const counts = [
      { sku_id: 'a', counted: 8 },   // -2
      { sku_id: 'b', counted: 5 },   // unchanged -> dropped
      { sku_id: 'c', counted: 3 },   // +3 (no prior balance row)
    ]
    expect(computeOpnameDeltas(counts, balances)).toEqual([
      { sku_id: 'a', delta: -2 },
      { sku_id: 'c', delta: 3 },
    ])
  })

  it('treats a missing balance as zero', () => {
    expect(computeOpnameDeltas([{ sku_id: 'x', counted: 4 }], [])).toEqual([
      { sku_id: 'x', delta: 4 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/stock/opname.test.ts`
Expected: FAIL — cannot resolve `./opname`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/stock/opname.ts`:

```ts
export type OpnameBalance = { sku_id: string; balance: number }
export type OpnameCount = { sku_id: string; counted: number }
export type OpnameDelta = { sku_id: string; delta: number }

// Physical count minus system balance, per sku. Only non-zero deltas are
// returned — an sku counted equal to its balance needs no adjustment.
export function computeOpnameDeltas(
  counts: OpnameCount[],
  balances: OpnameBalance[],
): OpnameDelta[] {
  const balanceOf = new Map(balances.map((b) => [b.sku_id, b.balance]))
  return counts
    .map((c) => ({ sku_id: c.sku_id, delta: c.counted - (balanceOf.get(c.sku_id) ?? 0) }))
    .filter((d) => d.delta !== 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/stock/opname.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stock/opname.ts src/lib/stock/opname.test.ts
git commit -m "feat: opname delta computation + tests"
```

---

## Task 7: Locations UI

**Files:**
- Create: `src/lib/locations/actions.ts`, `src/app/(app)/locations/page.tsx`, `src/app/(app)/locations/LocationForm.tsx`
- Modify: `src/components/SideNav.tsx`

- [ ] **Step 1: Write the server actions**

Create `src/lib/locations/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createLocation(input: { name: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('locations').insert({ name: input.name })
  if (error) return { error: error.message }
  revalidatePath('/locations')
}

export async function toggleLocation(id: string, active: boolean): Promise<void> {
  const supabase = await createClient()
  await supabase.from('locations').update({ active }).eq('id', id)
  revalidatePath('/locations')
}
```

- [ ] **Step 2: Write the form component**

Create `src/app/(app)/locations/LocationForm.tsx` (mirrors `VendorForm`):

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLocation } from '@/lib/locations/actions'

export default function LocationForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!name.trim()) { setError('Nama wajib diisi'); return }
    setSaving(true)
    const res = await createLocation({ name: name.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Lokasi Baru</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label className="vb-label">Nama</label>
          <input className="vb-input" placeholder="Toko Bandung" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <div className="vb-danger">{error}</div>}
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ alignSelf: 'flex-end' }}>{saving ? 'Menyimpan…' : 'Simpan Lokasi'}</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the page**

Create `src/app/(app)/locations/page.tsx` (mirrors `vendors/page.tsx`):

```tsx
import { createClient } from '@/lib/supabase/server'
import LocationForm from './LocationForm'

export default async function LocationsPage() {
  const supabase = await createClient()
  const { data: locations } = await supabase
    .from('locations').select('id, name, is_default, active').order('name')
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Lokasi</h1>
        <div className="vb-sub">{locations?.length ?? 0} lokasi terdaftar</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1.6fr 100px 100px' }}>
            <div>Nama</div><div>Default</div><div>Status</div>
          </div>
          {!locations?.length ? (
            <div className="vb-empty">Belum ada lokasi.</div>
          ) : locations.map((l) => (
            <div key={l.id} className="vb-row" style={{ gridTemplateColumns: '1.6fr 100px 100px' }}>
              <div style={{ fontWeight: 500 }}>{l.name}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{l.is_default ? 'Ya' : '—'}</div>
              <div>
                <span className="vb-badge" style={l.active
                  ? { background: 'rgba(147,214,161,.13)', color: '#93d6a1' }
                  : { background: 'rgba(143,136,123,.13)', color: 'var(--vb-muted)' }}>
                  {l.active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <LocationForm />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add nav entry**

In `src/components/SideNav.tsx`, add a settings group to `GROUPS` (after the Penjualan group):

```tsx
  { title: 'Pengaturan', items: [{ label: 'Lokasi', href: '/locations' }] },
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/locations src/app/\(app\)/locations src/components/SideNav.tsx
git commit -m "feat: locations CRUD page + nav"
```

---

## Task 8: Materials UI

**Files:**
- Create: `src/lib/materials/actions.ts`, `src/app/(app)/materials/page.tsx`, `src/app/(app)/materials/MaterialForm.tsx`
- Modify: `src/components/SideNav.tsx`

- [ ] **Step 1: Write the server actions**

Create `src/lib/materials/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createMaterial(input: {
  code: string; name: string; category: string; uom: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('materials').insert({
    code: input.code, name: input.name, category: input.category, uom: input.uom,
  })
  if (error) return { error: error.message }
  revalidatePath('/materials')
}

export async function toggleMaterial(id: string, active: boolean): Promise<void> {
  const supabase = await createClient()
  await supabase.from('materials').update({ active }).eq('id', id)
  revalidatePath('/materials')
}
```

- [ ] **Step 2: Write the form component**

Create `src/app/(app)/materials/MaterialForm.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createMaterial } from '@/lib/materials/actions'

const CATEGORIES = [
  { v: 'fabric', l: 'Kain' },
  { v: 'trim', l: 'Trim' },
  { v: 'accessory', l: 'Aksesoris' },
  { v: 'other', l: 'Lainnya' },
]

export default function MaterialForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('fabric')
  const [uom, setUom] = useState('m')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!code.trim()) { setError('Kode wajib diisi'); return }
    if (!name.trim()) { setError('Nama wajib diisi'); return }
    if (!uom.trim()) { setError('Satuan wajib diisi'); return }
    setSaving(true)
    const res = await createMaterial({ code: code.trim(), name: name.trim(), category, uom: uom.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setCode(''); setName(''); setUom('m'); setCategory('fabric'); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Bahan Baru</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label className="vb-label">Kode</label>
          <input className="vb-input" placeholder="FAB-001" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">Nama</label>
          <input className="vb-input" placeholder="Katun Combed 30s" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">Kategori</label>
          <select className="vb-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Satuan</label>
          <input className="vb-input" placeholder="m / pcs / roll / kg" value={uom} onChange={(e) => setUom(e.target.value)} />
        </div>
        {error && <div className="vb-danger">{error}</div>}
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ alignSelf: 'flex-end' }}>{saving ? 'Menyimpan…' : 'Simpan Bahan'}</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the page**

Create `src/app/(app)/materials/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import MaterialForm from './MaterialForm'

const CAT_LABEL: Record<string, string> = { fabric: 'Kain', trim: 'Trim', accessory: 'Aksesoris', other: 'Lainnya' }

export default async function MaterialsPage() {
  const supabase = await createClient()
  const { data: materials } = await supabase
    .from('materials').select('id, code, name, category, uom, active').order('code')
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Bahan</h1>
        <div className="vb-sub">{materials?.length ?? 0} bahan terdaftar</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '0.9fr 1.6fr 0.9fr 0.6fr 90px' }}>
            <div>Kode</div><div>Nama</div><div>Kategori</div><div>Satuan</div><div>Status</div>
          </div>
          {!materials?.length ? (
            <div className="vb-empty">Belum ada bahan.</div>
          ) : materials.map((m) => (
            <div key={m.id} className="vb-row" style={{ gridTemplateColumns: '0.9fr 1.6fr 0.9fr 0.6fr 90px' }}>
              <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{m.code}</div>
              <div style={{ fontWeight: 500 }}>{m.name}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{CAT_LABEL[m.category] ?? m.category}</div>
              <div className="vb-muted" style={{ fontSize: 12.5 }}>{m.uom}</div>
              <div>
                <span className="vb-badge" style={m.active
                  ? { background: 'rgba(147,214,161,.13)', color: '#93d6a1' }
                  : { background: 'rgba(143,136,123,.13)', color: 'var(--vb-muted)' }}>
                  {m.active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <MaterialForm />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add nav entry**

In `src/components/SideNav.tsx`, add `Bahan` to the `Produk` group items, after `Stok`:

```tsx
{ label: 'Bahan', href: '/materials' },
```

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/lib/materials src/app/\(app\)/materials src/components/SideNav.tsx
git commit -m "feat: materials catalog CRUD page + nav"
```

---

## Task 9: Stock page — per-location balances, transfer, opname

**Files:**
- Modify: `src/lib/stock/actions.ts`, `src/app/(app)/stock/page.tsx`, `src/lib/ui.ts`
- Create: `src/app/(app)/stock/TransferForm.tsx`, `src/app/(app)/stock/OpnameForm.tsx`

- [ ] **Step 1: Add transfer + opname server actions**

Append to `src/lib/stock/actions.ts`:

```ts
export async function recordTransfer(input: {
  sku_id: string; qty: number; from_location: string; to_location: string; reason?: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('record_transfer', {
    p_sku_id: input.sku_id,
    p_qty: input.qty,
    p_from_location: input.from_location,
    p_to_location: input.to_location,
    p_reason: input.reason ?? undefined,
  })
  if (error) return { error: error.message }
  revalidatePath('/stock')
}

export async function postOpname(input: {
  location_id: string; deltas: { sku_id: string; delta: number }[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  for (const d of input.deltas) {
    const { error } = await supabase.rpc('record_movement', {
      p_sku_id: d.sku_id,
      p_qty: d.delta,
      p_movement_type: 'adjustment',
      p_reason: 'opname',
      p_location_id: input.location_id,
    })
    if (error) return { error: error.message }
  }
  revalidatePath('/stock')
}
```

- [ ] **Step 2: Add transfer badge meta**

In `src/lib/ui.ts`, add two entries to `MOVEMENT_META`:

```ts
  transfer_out: { label: 'Transfer Keluar', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
  transfer_in: { label: 'Transfer Masuk', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
```

- [ ] **Step 3: Write the TransferForm component**

Create `src/app/(app)/stock/TransferForm.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordTransfer } from '@/lib/stock/actions'

type SkuOption = { id: string; sku_code: string }
type LocOption = { id: string; name: string }

export default function TransferForm({ skus, locations }: { skus: SkuOption[]; locations: LocOption[] }) {
  const router = useRouter()
  const [skuId, setSkuId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    const n = parseInt(qty, 10)
    if (!skuId) { setError('Pilih SKU'); return }
    if (!from || !to) { setError('Pilih lokasi asal & tujuan'); return }
    if (from === to) { setError('Lokasi asal & tujuan harus beda'); return }
    if (!Number.isInteger(n) || n <= 0) { setError('Qty harus angka positif'); return }
    setSaving(true)
    const res = await recordTransfer({ sku_id: skuId, qty: n, from_location: from, to_location: to })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setQty(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Transfer Antar Lokasi</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 80px auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label className="vb-label">SKU</label>
          <select className="vb-input" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            <option value="">Pilih SKU…</option>
            {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Dari</label>
          <select className="vb-input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Asal…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Ke</label>
          <select className="vb-input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Tujuan…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Qty</label>
          <input className="vb-input" placeholder="6" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ height: 37 }}>
          {saving ? 'Memindah…' : 'Transfer'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write the OpnameForm component**

Create `src/app/(app)/stock/OpnameForm.tsx`. It fetches nothing itself — the page passes skus and per-location balances; it uses the pure `computeOpnameDeltas` before posting:

```tsx
'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { postOpname } from '@/lib/stock/actions'
import { computeOpnameDeltas } from '@/lib/stock/opname'

type SkuOption = { id: string; sku_code: string }
type LocOption = { id: string; name: string }
// balancesByLoc: location_id -> (sku_id -> balance)
type BalMap = Record<string, Record<string, number>>

export default function OpnameForm({
  skus, locations, balancesByLoc,
}: { skus: SkuOption[]; locations: LocOption[]; balancesByLoc: BalMap }) {
  const router = useRouter()
  const [locId, setLocId] = useState('')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const balances = useMemo(
    () => skus.map((s) => ({ sku_id: s.id, balance: (locId && balancesByLoc[locId]?.[s.id]) || 0 })),
    [skus, locId, balancesByLoc],
  )

  async function onSave() {
    setError(null)
    if (!locId) { setError('Pilih lokasi'); return }
    const countRows = Object.entries(counts)
      .filter(([, v]) => v.trim() !== '')
      .map(([sku_id, v]) => ({ sku_id, counted: parseInt(v, 10) }))
      .filter((c) => Number.isInteger(c.counted) && c.counted >= 0)
    const deltas = computeOpnameDeltas(countRows, balances)
    if (!deltas.length) { setError('Tidak ada selisih untuk diposting'); return }
    setSaving(true)
    const res = await postOpname({ location_id: locId, deltas })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setCounts({}); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Stok Opname</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ marginBottom: 12, maxWidth: 260 }}>
        <label className="vb-label">Lokasi</label>
        <select className="vb-input" value={locId} onChange={(e) => setLocId(e.target.value)}>
          <option value="">Pilih lokasi…</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 90px 110px' }}>
        <div>Kode SKU</div><div style={{ textAlign: 'right' }}>Sistem</div><div style={{ textAlign: 'right' }}>Hitung fisik</div>
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {skus.map((s) => {
          const sys = (locId && balancesByLoc[locId]?.[s.id]) || 0
          return (
            <div key={s.id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 90px 110px', alignItems: 'center' }}>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{s.sku_code}</div>
              <div className="vb-mono" style={{ textAlign: 'right' }}>{sys}</div>
              <input
                className="vb-input"
                style={{ textAlign: 'right', height: 30 }}
                placeholder={String(sys)}
                value={counts[s.id] ?? ''}
                onChange={(e) => setCounts((c) => ({ ...c, [s.id]: e.target.value }))}
              />
            </div>
          )
        })}
      </div>
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ marginTop: 12 }}>
        {saving ? 'Memposting…' : 'Posting Selisih'}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Rewrite the stock page to load locations + per-location balances**

Replace `src/app/(app)/stock/page.tsx` with:

```tsx
import { createClient } from '@/lib/supabase/server'
import AdjustForm from './AdjustForm'
import TransferForm from './TransferForm'
import OpnameForm from './OpnameForm'
import { MOVEMENT_META, rp } from '@/lib/ui'

export default async function StockPage() {
  const supabase = await createClient()

  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  const { data: locations } = await supabase.from('locations').select('id, name').eq('active', true).order('name')
  const { data: byLoc } = await supabase
    .from('stock_balances_by_location').select('sku_id, location_id, balance')
  const { data: movements } = await supabase
    .from('stock_ledger')
    .select('id, sku_id, location_id, qty, movement_type, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))
  const locName = new Map((locations ?? []).map((l) => [l.id, l.name]))

  // balancesByLoc: location_id -> (sku_id -> balance), for OpnameForm
  const balancesByLoc: Record<string, Record<string, number>> = {}
  for (const b of byLoc ?? []) {
    if (!b.location_id || !b.sku_id) continue
    ;(balancesByLoc[b.location_id] ??= {})[b.sku_id] = b.balance ?? 0
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Stok</h1>
        <div className="vb-sub">{byLoc?.length ?? 0} saldo SKU × lokasi</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.7fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Saldo per Lokasi</div>
          <div className="vb-thead" style={{ gridTemplateColumns: '1fr 1fr 80px' }}>
            <div>Kode SKU</div><div>Lokasi</div><div style={{ textAlign: 'right' }}>Saldo</div>
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {!byLoc?.length ? (
              <div className="vb-empty">Belum ada pergerakan.</div>
            ) : byLoc.map((b) => (
              <div key={`${b.sku_id}-${b.location_id}`} className="vb-row" style={{ gridTemplateColumns: '1fr 1fr 80px' }}>
                <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{codeOf.get(b.sku_id ?? '') ?? b.sku_id}</div>
                <div className="vb-muted" style={{ fontSize: 12.5 }}>{locName.get(b.location_id ?? '') ?? '—'}</div>
                <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600, color: (b.balance ?? 0) < 0 ? 'var(--vb-danger)' : 'var(--vb-text)' }}>{b.balance}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TransferForm skus={skus ?? []} locations={locations ?? []} />
          <AdjustForm skus={skus ?? []} />
          <OpnameForm skus={skus ?? []} locations={locations ?? []} balancesByLoc={balancesByLoc} />
          <div className="vb-card" style={{ overflow: 'hidden' }}>
            <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Pergerakan Terakhir</div>
            <div className="vb-thead" style={{ gridTemplateColumns: '1.2fr 120px 60px 1fr 1.2fr' }}>
              <div>Kode SKU</div><div>Tipe</div><div style={{ textAlign: 'right' }}>Qty</div><div>Lokasi</div><div>Alasan</div>
            </div>
            {!movements?.length ? (
              <div className="vb-empty">Belum ada pergerakan.</div>
            ) : movements.map((m) => {
              const meta = MOVEMENT_META[m.movement_type] ?? { label: m.movement_type, c: 'var(--vb-muted)', bg: 'transparent' }
              return (
                <div key={m.id} className="vb-row" style={{ gridTemplateColumns: '1.2fr 120px 60px 1fr 1.2fr' }}>
                  <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{codeOf.get(m.sku_id) ?? m.sku_id}</div>
                  <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
                  <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600, color: m.qty < 0 ? 'var(--vb-danger)' : '#93d6a1' }}>{rp(m.qty)}</div>
                  <div className="vb-muted" style={{ fontSize: 12.5 }}>{locName.get(m.location_id ?? '') ?? '—'}</div>
                  <div className="vb-muted" style={{ fontSize: 12.5 }}>{m.reason ?? '—'}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual smoke via dev server**

Start the app (project runs dev + Playwright on port 3100 — see memory `vobia-dev-ports`): `npm run dev -- -p 3100`. Log in, open **Stok**. Verify: per-location balance table renders; Transfer moves qty between two locations and the ledger shows `Transfer Keluar` / `Transfer Masuk`; Opname on a location with a changed count posts a `Penyesuaian` row.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stock/actions.ts src/lib/ui.ts src/app/\(app\)/stock
git commit -m "feat: stock transfer + opname UI, per-location balances"
```

---

## Task 10: E2E — transfer flow

**Files:**
- Create: `e2e/transfer.spec.ts` (match the existing `e2e/` spec style)

- [ ] **Step 1: Inspect an existing spec for the login/setup helper**

Read one existing spec (e.g. `e2e/*.spec.ts`) to reuse its auth/setup helper and base URL (port 3100). Do not invent a new login flow — reuse whatever the returns/orders specs use.

- [ ] **Step 2: Write the transfer E2E**

Create `e2e/transfer.spec.ts` following that spec's structure. The flow:
1. Log in (reuse helper).
2. Ensure a second location exists: go to `/locations`, add `Toko Kedua` if absent.
3. Ensure stock exists at the default location for some SKU (use an existing seeded SKU, or post a `production_in` via the Stok adjust form / production receive — whatever the other specs already do to get stock).
4. Go to `/stock`, use Transfer: pick the SKU, from = Gudang Utama, to = Toko Kedua, qty = 1, submit.
5. Assert the "Pergerakan Terakhir" list shows a `Transfer Masuk` row, and the per-location table now shows a balance for Toko Kedua.

Write the actual selectors/assertions to match the existing specs' conventions (they already target `.vb-*` classed elements and Bahasa labels).

- [ ] **Step 3: Run the E2E**

Run: `npm run e2e -- transfer.spec.ts`
Expected: PASS.

- [ ] **Step 4: Run the full DB + unit suite as a regression gate**

```bash
npm run test:db supabase/tests/stock_ledger.test.sql supabase/tests/stock_location.test.sql supabase/tests/locations.test.sql supabase/tests/materials.test.sql
npm run test
```
Expected: all `RESULT: PASS`, vitest green.

- [ ] **Step 5: Commit**

```bash
git add e2e/transfer.spec.ts
git commit -m "test: E2E stock transfer between locations"
```

---

## Done criteria

- `locations` + `materials` masters exist with RLS; every tenant has one default location.
- `stock_ledger` rows carry `location_id`; existing rows backfilled to default.
- `record_movement` defaults to the tenant's default location and still serves all legacy callers unchanged (verified by `stock_ledger.test.sql` still passing).
- `record_transfer` conserves total balance and rejects overdraw / same-location.
- Opname posts only non-zero deltas at the chosen location.
- UI: Lokasi + Bahan pages; Stok page shows per-location balances, transfer, opname.
- Green: `npm run test`, all four DB test files, `transfer.spec.ts`.

## Not in Fase A (carried forward)

- Material **stock** (ledger + goods receipt) → Fase B, with purchasing.
- Customer master → deferred; `orders.customer` text stays.
- Opname session history table → add only if audit trail of counts is needed.
