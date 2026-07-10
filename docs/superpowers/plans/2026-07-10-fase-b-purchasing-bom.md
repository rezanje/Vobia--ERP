# Fase B — Material Stock + Purchasing + BOM + Issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track raw-material stock with a location-aware ledger, buy materials via purchase orders with partial receipts, define BOM per style, and issue materials to a production order (CMT) — while maklon orders simply never issue.

**Architecture:** A new `material_ledger` mirrors `stock_ledger` (append-only, decimal quantities, single writer `record_material_movement`). Purchasing (`purchase_orders`/`purchase_lines`) receives goods via `receive_purchase`, which posts `purchase_in`. BOM (`bom_lines`) is edited directly under RLS. `issue_material_to_po` posts `issue_out` against a production order, quantities suggested by the pure `suggestIssue`. UI mirrors the existing vendor/stock/production pages using the `.vb-*` design system.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase Postgres + RLS, plpgsql `security definer` functions, pgtap DB tests (`npm run test:db`), vitest, hand-written types in `src/types/database.ts`.

**Migration/test flow:** DB tests run against the remote dev DB via the pgtap harness (each test wrapped in rollback). A migration must be applied before its test passes. Load env first, then apply, in the SAME shell line:
`set -a; . ./.env.local; set +a; npx supabase db push --db-url "$SUPABASE_DB_URL"`
Run tests: `set -a; . ./.env.local; set +a; npm run test:db supabase/tests/<file>.test.sql`
(A Docker "failed to cache migrations catalog" warning is non-fatal.) Shared remote DB with ~30 tenants; every tenant already has a default location (Fase A). Never commit `.env.local`, `next-env.d.ts`, or `tsconfig.tsbuildinfo`. Branch `feat/fase-b-purchasing-bom` is already checked out.

---

## File Structure

**Migrations (create):**
- `supabase/migrations/20260710000001_material_ledger.sql` — table + append-only + `material_balances`/`material_balances_by_location` views
- `supabase/migrations/20260710000002_record_material_movement.sql` — sole writer function
- `supabase/migrations/20260710000003_purchasing.sql` — `purchase_orders` + `purchase_lines`
- `supabase/migrations/20260710000004_purchasing_fns.sql` — `create_purchase_order` + `receive_purchase`
- `supabase/migrations/20260710000005_bom.sql` — `bom_lines`
- `supabase/migrations/20260710000006_issue_material.sql` — `issue_material_to_po`

**DB tests (create):**
- `supabase/tests/material_ledger.test.sql`
- `supabase/tests/purchasing.test.sql`
- `supabase/tests/bom_issue.test.sql`

**Pure logic + test (create):**
- `src/lib/bom/suggest.ts` + `src/lib/bom/suggest.test.ts`

**Server actions (create):**
- `src/lib/materials/stock.ts` — `recordMaterialAdjustment`
- `src/lib/purchasing/actions.ts` — `createPurchaseOrder`, `receivePurchase`
- `src/lib/bom/actions.ts` — `addBomLine`, `removeBomLine`
- `src/lib/production/issue.ts` — `issueMaterialToPo`

**Pages/components (create):**
- `src/app/(app)/material-stock/page.tsx` + `MaterialAdjustForm.tsx`
- `src/app/(app)/purchasing/page.tsx` + `PurchaseForm.tsx`
- `src/app/(app)/purchasing/[id]/page.tsx` + `ReceiveForm.tsx`
- `src/app/(app)/styles/[id]/BomSection.tsx`
- `src/app/(app)/production/[id]/IssueSection.tsx`

**Modify:**
- `src/types/database.ts` — all new tables/views/functions
- `src/lib/ui.ts` — `MATERIAL_MOVEMENT_META`
- `src/components/SideNav.tsx` — Pembelian group
- `src/app/(app)/styles/[id]/page.tsx` — mount `BomSection`
- `src/app/(app)/production/[id]/page.tsx` — mount `IssueSection`

---

## Task 1: `material_ledger` table + balance views

**Files:**
- Create: `supabase/migrations/20260710000001_material_ledger.sql`
- Test: `supabase/tests/material_ledger.test.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/material_ledger.test.sql`:

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('d1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','mled@s.test','{"tenant_name":"MLed Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='d1111111-1111-1111-1111-111111111111');
begin
  -- append-only: direct writes denied to authenticated
  perform set_config('request.jwt.claims',
    json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);
  begin
    insert into public.material_ledger (tenant_id, material_id, location_id, qty, movement_type)
    values (v_tenant, gen_random_uuid(), gen_random_uuid(), 5, 'purchase_in');
    raise exception 'expected permission denied on direct insert';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'material_ledger OK: append-only enforced';
end $$;

rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.local; set +a; npm run test:db supabase/tests/material_ledger.test.sql`
Expected: ERROR — `relation "public.material_ledger" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260710000001_material_ledger.sql`:

```sql
create table public.material_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  material_id uuid not null references public.materials(id),
  location_id uuid not null references public.locations(id),
  qty numeric(14,3) not null,
  movement_type text not null
    check (movement_type in ('purchase_in','issue_out','adjustment','transfer_in','transfer_out')),
  reason text,
  ref_type text,
  ref_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint material_qty_nonzero check (qty <> 0),
  constraint material_adjustment_reason check (
    movement_type <> 'adjustment' or (reason is not null and trim(reason) <> '')
  )
);
create index material_ledger_material_idx on public.material_ledger(material_id);
create index material_ledger_location_idx on public.material_ledger(location_id);
create index material_ledger_tenant_created_idx on public.material_ledger(tenant_id, created_at desc);

alter table public.material_ledger enable row level security;
create policy tenant_isolation on public.material_ledger
  for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- append-only: record_material_movement() is the only writer
revoke insert, update, delete on public.material_ledger from authenticated;
grant select on public.material_ledger to authenticated;

create view public.material_balances_by_location with (security_invoker = on) as
select material_id, location_id, tenant_id, sum(qty)::numeric(14,3) as balance
from public.material_ledger
group by material_id, location_id, tenant_id;

create view public.material_balances with (security_invoker = on) as
select material_id, tenant_id, sum(qty)::numeric(14,3) as balance
from public.material_ledger
group by material_id, tenant_id;

grant select on public.material_balances_by_location to authenticated;
grant select on public.material_balances to authenticated;
```

- [ ] **Step 4: Apply the migration**

Run: `set -a; . ./.env.local; set +a; npx supabase db push --db-url "$SUPABASE_DB_URL"`
Expected: `20260710000001_material_ledger` applied, no ERROR.

- [ ] **Step 5: Run test to verify it passes**

Run: `set -a; . ./.env.local; set +a; npm run test:db supabase/tests/material_ledger.test.sql`
Expected: `RESULT: PASS`, notice `material_ledger OK: append-only enforced`.

- [ ] **Step 6: Add types**

In `src/types/database.ts`, inside `Tables` (after `materials`), add:

```ts
      material_ledger: {
        Row: { id: string; tenant_id: string; material_id: string; location_id: string; qty: number; movement_type: string; reason: string | null; ref_type: string | null; ref_id: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; material_id: string; location_id: string; qty: number; movement_type: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; material_id?: string; location_id?: string; qty?: number; movement_type?: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
```

Inside `Views`, add:

```ts
      material_balances_by_location: {
        Row: { material_id: string | null; location_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
      material_balances: {
        Row: { material_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
```

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add supabase/migrations/20260710000001_material_ledger.sql supabase/tests/material_ledger.test.sql src/types/database.ts
git commit -m "feat: material_ledger table + balance views"
```

---

## Task 2: `record_material_movement` function

**Files:**
- Create: `supabase/migrations/20260710000002_record_material_movement.sql`
- Modify: `supabase/tests/material_ledger.test.sql`, `src/types/database.ts`

- [ ] **Step 1: Add failing assertions to the test**

Append a second `do $$ ... end $$;` block to `supabase/tests/material_ledger.test.sql`, before `rollback;`:

```sql
do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='d1111111-1111-1111-1111-111111111111');
  v_mat uuid; v_loc uuid; v_bal numeric;
  v_other_tenant uuid; v_other_mat uuid;
begin
  -- foreign tenant + material for cross-tenant check
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
    values ('d2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
            'authenticated','authenticated','mled2@s.test','{"tenant_name":"MLed Other"}');
  v_other_tenant := (select tenant_id from public.profiles where id='d2222222-2222-2222-2222-222222222222');
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_other_tenant, 'OTH-FAB', 'Oth', 'fabric', 'm') returning id into v_other_mat;

  perform set_config('request.jwt.claims',
    json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_tenant, 'FAB-30S', 'Katun', 'fabric', 'm') returning id into v_mat;
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;

  -- purchase_in with no location → default; positive
  perform public.record_material_movement(v_mat, 100, 'purchase_in');
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 100 then raise exception 'expected 100 at default, got %', v_bal; end if;

  -- issue_out stored negative
  perform public.record_material_movement(v_mat, 30, 'issue_out', null, null, null, v_loc);
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 70 then raise exception 'expected 70 after issue, got %', v_bal; end if;

  -- adjustment requires reason
  begin
    perform public.record_material_movement(v_mat, 5, 'adjustment');
    raise exception 'ADJ_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%requires a reason%' then raise; end if;
  end;

  -- cross-tenant material rejected
  begin
    perform public.record_material_movement(v_other_mat, 5, 'purchase_in');
    raise exception 'XT_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%another tenant%' then raise; end if;
  end;

  raise notice 'record_material_movement OK: default loc, signs, reason, cross-tenant';
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.local; set +a; npm run test:db supabase/tests/material_ledger.test.sql`
Expected: FAIL — `function public.record_material_movement(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260710000002_record_material_movement.sql`:

```sql
create or replace function public.record_material_movement(
  p_material_id uuid,
  p_qty numeric,
  p_movement_type text,
  p_reason text default null,
  p_ref_type text default null,
  p_ref_id uuid default null,
  p_location_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_mat_tenant uuid;
  v_loc_tenant uuid;
  v_location uuid;
  v_qty numeric;
  v_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_qty = 0 then raise exception 'qty must be non-zero'; end if;
  if p_movement_type not in ('purchase_in','issue_out','adjustment','transfer_in','transfer_out') then
    raise exception 'invalid movement_type: %', p_movement_type;
  end if;

  select tenant_id into v_mat_tenant from public.materials where id = p_material_id;
  if v_mat_tenant is null then raise exception 'material not found'; end if;
  if v_mat_tenant <> v_tenant then raise exception 'material belongs to another tenant'; end if;

  if p_location_id is null then
    select id into v_location from public.locations where tenant_id = v_tenant and is_default limit 1;
    if v_location is null then raise exception 'no default location for tenant'; end if;
  else
    select tenant_id into v_loc_tenant from public.locations where id = p_location_id;
    if v_loc_tenant is null then raise exception 'location not found'; end if;
    if v_loc_tenant <> v_tenant then raise exception 'location belongs to another tenant'; end if;
    v_location := p_location_id;
  end if;

  if p_movement_type = 'adjustment' then
    if p_reason is null or trim(p_reason) = '' then raise exception 'adjustment requires a reason'; end if;
    v_qty := p_qty;
  elsif p_movement_type in ('issue_out','transfer_out') then
    v_qty := -abs(p_qty);
  else
    v_qty := abs(p_qty);  -- purchase_in, transfer_in
  end if;

  insert into public.material_ledger
    (tenant_id, material_id, location_id, qty, movement_type, reason, ref_type, ref_id, created_by)
  values
    (v_tenant, p_material_id, v_location, v_qty, p_movement_type, p_reason, p_ref_type, p_ref_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function
  public.record_material_movement(uuid, numeric, text, text, text, uuid, uuid) to authenticated;
```

- [ ] **Step 4: Apply + green**

```bash
set -a; . ./.env.local; set +a; npx supabase db push --db-url "$SUPABASE_DB_URL"
set -a; . ./.env.local; set +a; npm run test:db supabase/tests/material_ledger.test.sql
```
Expected: `RESULT: PASS`, notice `record_material_movement OK: ...`.

- [ ] **Step 5: Add type + commit**

In `src/types/database.ts` `Functions`, add:

```ts
      record_material_movement: {
        Args: { p_material_id: string; p_qty: number; p_movement_type: string; p_reason?: string; p_ref_type?: string; p_ref_id?: string; p_location_id?: string }
        Returns: string
      }
```

Run `npx tsc --noEmit` (expect no errors), then:

```bash
git add supabase/migrations/20260710000002_record_material_movement.sql supabase/tests/material_ledger.test.sql src/types/database.ts
git commit -m "feat: record_material_movement writer"
```

---

## Task 3: `purchase_orders` + `purchase_lines` tables

**Files:**
- Create: `supabase/migrations/20260710000003_purchasing.sql`
- Test: `supabase/tests/purchasing.test.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/purchasing.test.sql`:

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('e1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','pur@s.test','{"tenant_name":"Pur Co"}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('e2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','pur2@s.test','{"tenant_name":"Pur Other"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='e1111111-1111-1111-1111-111111111111');
  v_other  uuid := (select tenant_id from public.profiles where id='e2222222-2222-2222-2222-222222222222');
  v_vendor uuid; v_loc uuid; v_po uuid;
begin
  -- seed a foreign PO to test RLS
  insert into public.vendors (tenant_id, name) values (v_other, 'OthVend');
  perform set_config('request.jwt.claims',
    json_build_object('sub','e1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.vendors (tenant_id, name) values (v_tenant, 'MyVend') returning id into v_vendor;
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;
  insert into public.purchase_orders (tenant_id, code, vendor_id, location_id)
    values (v_tenant, 'PB-TEST01', v_vendor, v_loc) returning id into v_po;
  insert into public.purchase_lines (tenant_id, po_id, material_id, qty_ordered, unit_price)
    values (v_tenant, v_po,
      (insert into public.materials (tenant_id, code, name, category, uom)
        values (v_tenant,'FAB-P','Kain','fabric','m') returning id), 50, 12000);

  -- RLS: foreign tenant's POs invisible
  if exists (select 1 from public.purchase_orders where tenant_id = v_other) then
    raise exception 'RLS leak on purchase_orders';
  end if;
  reset role;
  raise notice 'purchasing tables OK: insert + RLS';
end $$;

rollback;
```

> Note: Postgres does not allow an `insert ... returning` as a scalar subexpression inside another `insert ... values`. Rewrite the material insert as a separate statement into a variable `v_mat uuid;` and use `v_mat` in the `purchase_lines` insert. Declare `v_mat uuid;` in the `declare` block. Do this when writing the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.local; set +a; npm run test:db supabase/tests/purchasing.test.sql`
Expected: ERROR — `relation "public.purchase_orders" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260710000003_purchasing.sql`:

```sql
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  vendor_id uuid not null references public.vendors(id),
  location_id uuid not null references public.locations(id),
  order_date date not null default current_date,
  status text not null default 'open' check (status in ('open','received','canceled')),
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index purchase_orders_tenant_status_idx on public.purchase_orders(tenant_id, status);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty_ordered numeric(14,3) not null check (qty_ordered > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  qty_received numeric(14,3) not null default 0 check (qty_received >= 0),
  created_at timestamptz not null default now()
);
create index purchase_lines_po_idx on public.purchase_lines(po_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_lines enable row level security;
create policy tenant_isolation on public.purchase_orders for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.purchase_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_lines to authenticated;
```

- [ ] **Step 4: Apply + green**

```bash
set -a; . ./.env.local; set +a; npx supabase db push --db-url "$SUPABASE_DB_URL"
set -a; . ./.env.local; set +a; npm run test:db supabase/tests/purchasing.test.sql
```
Expected: `RESULT: PASS`.

- [ ] **Step 5: Add types + commit**

In `src/types/database.ts` `Tables`, add:

```ts
      purchase_orders: {
        Row: { id: string; tenant_id: string; code: string; vendor_id: string; location_id: string; order_date: string; status: string; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; vendor_id: string; location_id: string; order_date?: string; status?: string; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; vendor_id?: string; location_id?: string; order_date?: string; status?: string; notes?: string | null; created_at?: string }
        Relationships: []
      }
      purchase_lines: {
        Row: { id: string; tenant_id: string; po_id: string; material_id: string; qty_ordered: number; unit_price: number; qty_received: number; created_at: string }
        Insert: { id?: string; tenant_id: string; po_id: string; material_id: string; qty_ordered: number; unit_price?: number; qty_received?: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; po_id?: string; material_id?: string; qty_ordered?: number; unit_price?: number; qty_received?: number; created_at?: string }
        Relationships: []
      }
```

Run `npx tsc --noEmit`, then:

```bash
git add supabase/migrations/20260710000003_purchasing.sql supabase/tests/purchasing.test.sql src/types/database.ts
git commit -m "feat: purchase_orders + purchase_lines tables"
```

---

## Task 4: `create_purchase_order` + `receive_purchase`

**Files:**
- Create: `supabase/migrations/20260710000004_purchasing_fns.sql`
- Modify: `supabase/tests/purchasing.test.sql`, `src/types/database.ts`

- [ ] **Step 1: Add failing assertions to the test**

Append a `do $$ ... end $$;` block to `supabase/tests/purchasing.test.sql`, before `rollback;`:

```sql
do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='e1111111-1111-1111-1111-111111111111');
  v_vendor uuid; v_loc uuid; v_mat uuid; v_po uuid; v_line uuid;
  v_bal numeric; v_status text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','e1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.vendors (tenant_id, name) values (v_tenant, 'Vend2') returning id into v_vendor;
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_tenant, 'FAB-R', 'KainR', 'fabric', 'm') returning id into v_mat;

  v_po := public.create_purchase_order(v_vendor, v_loc, current_date, 'test PO',
    jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty_ordered', 100, 'unit_price', 15000)));
  select id into v_line from public.purchase_lines where po_id = v_po;

  -- partial receive 40 → material_in 40, qty_received 40, status still open
  perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 40)));
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 40 then raise exception 'expected 40 received, got %', v_bal; end if;
  select status into v_status from public.purchase_orders where id = v_po;
  if v_status <> 'open' then raise exception 'expected open after partial, got %', v_status; end if;

  -- over-receipt rejected (40 already + 100 > 100)
  begin
    perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 100)));
    raise exception 'OVER_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%over-receipt%' then raise; end if;
  end;

  -- receive remaining 60 → status received
  perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 60)));
  select status into v_status from public.purchase_orders where id = v_po;
  if v_status <> 'received' then raise exception 'expected received, got %', v_status; end if;
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 100 then raise exception 'expected 100 total, got %', v_bal; end if;

  raise notice 'purchasing fns OK: create, partial receive, over-receipt reject, full → received';
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.local; set +a; npm run test:db supabase/tests/purchasing.test.sql`
Expected: FAIL — `function public.create_purchase_order(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260710000004_purchasing_fns.sql`:

```sql
create or replace function public.create_purchase_order(
  p_vendor_id uuid,
  p_location_id uuid,
  p_order_date date,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text := 'PB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_po uuid;
  v_line jsonb;
  v_mat uuid;
  v_mat_tenant uuid;
  v_loc uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id and tenant_id = v_tenant) then
    raise exception 'vendor not in tenant';
  end if;
  if p_location_id is null then
    select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
    if v_loc is null then raise exception 'no default location'; end if;
  else
    if not exists (select 1 from public.locations where id = p_location_id and tenant_id = v_tenant) then
      raise exception 'location not in tenant';
    end if;
    v_loc := p_location_id;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then raise exception 'at least one line required'; end if;

  insert into public.purchase_orders (tenant_id, code, vendor_id, location_id, order_date, notes)
  values (v_tenant, v_code, p_vendor_id, v_loc, coalesce(p_order_date, current_date), nullif(trim(p_notes), ''))
  returning id into v_po;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_mat := (v_line ->> 'material_id')::uuid;
    select tenant_id into v_mat_tenant from public.materials where id = v_mat;
    if v_mat_tenant is null or v_mat_tenant <> v_tenant then raise exception 'material not in tenant'; end if;
    if (v_line ->> 'qty_ordered')::numeric <= 0 then raise exception 'qty_ordered must be > 0'; end if;
    insert into public.purchase_lines (tenant_id, po_id, material_id, qty_ordered, unit_price)
    values (v_tenant, v_po, v_mat, (v_line ->> 'qty_ordered')::numeric, coalesce((v_line ->> 'unit_price')::numeric, 0));
  end loop;

  return v_po;
end;
$$;

grant execute on function public.create_purchase_order(uuid, uuid, date, text, jsonb) to authenticated;

create or replace function public.receive_purchase(
  p_po_id uuid,
  p_receipts jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_status text;
  v_loc uuid;
  v_rec jsonb;
  v_line public.purchase_lines;
  v_qty numeric;
  v_all_full boolean;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select status, location_id into v_status, v_loc from public.purchase_orders
    where id = p_po_id and tenant_id = v_tenant;
  if v_status is null then raise exception 'purchase order not found'; end if;
  if v_status = 'canceled' then raise exception 'cannot receive a canceled PO'; end if;
  if p_receipts is null or jsonb_array_length(p_receipts) < 1 then raise exception 'no receipts'; end if;

  for v_rec in select value from jsonb_array_elements(p_receipts) loop
    v_qty := (v_rec ->> 'qty')::numeric;
    if v_qty <= 0 then raise exception 'receipt qty must be > 0'; end if;
    select * into v_line from public.purchase_lines
      where id = (v_rec ->> 'line_id')::uuid and po_id = p_po_id and tenant_id = v_tenant;
    if v_line.id is null then raise exception 'line not in PO'; end if;
    if v_line.qty_received + v_qty > v_line.qty_ordered then
      raise exception 'over-receipt on line %: % + % > %', v_line.id, v_line.qty_received, v_qty, v_line.qty_ordered;
    end if;
    update public.purchase_lines set qty_received = qty_received + v_qty where id = v_line.id;
    perform public.record_material_movement(v_line.material_id, v_qty, 'purchase_in', null, 'purchase_line', v_line.id, v_loc);
  end loop;

  select bool_and(qty_received >= qty_ordered) into v_all_full from public.purchase_lines where po_id = p_po_id;
  if v_all_full then update public.purchase_orders set status = 'received' where id = p_po_id; end if;
end;
$$;

grant execute on function public.receive_purchase(uuid, jsonb) to authenticated;
```

- [ ] **Step 4: Apply + green**

```bash
set -a; . ./.env.local; set +a; npx supabase db push --db-url "$SUPABASE_DB_URL"
set -a; . ./.env.local; set +a; npm run test:db supabase/tests/purchasing.test.sql
```
Expected: `RESULT: PASS`, notice `purchasing fns OK: ...`.

- [ ] **Step 5: Add types + commit**

In `src/types/database.ts` `Functions`, add:

```ts
      create_purchase_order: {
        Args: { p_vendor_id: string; p_location_id?: string | null; p_order_date?: string | null; p_notes: string; p_lines: Json }
        Returns: string
      }
      receive_purchase: {
        Args: { p_po_id: string; p_receipts: Json }
        Returns: undefined
      }
```

Run `npx tsc --noEmit`, then:

```bash
git add supabase/migrations/20260710000004_purchasing_fns.sql supabase/tests/purchasing.test.sql src/types/database.ts
git commit -m "feat: create_purchase_order + receive_purchase (partial receipts)"
```

---

## Task 5: `bom_lines` table

**Files:**
- Create: `supabase/migrations/20260710000005_bom.sql`
- Test: `supabase/tests/bom_issue.test.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/bom_issue.test.sql`:

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('f1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','bom@s.test','{"tenant_name":"Bom Co"}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('f2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','bom2@s.test','{"tenant_name":"Bom Other"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='f1111111-1111-1111-1111-111111111111');
  v_other  uuid := (select tenant_id from public.profiles where id='f2222222-2222-2222-2222-222222222222');
  v_style uuid; v_mat uuid;
begin
  -- foreign BOM row for RLS
  insert into public.styles (tenant_id, code, name) values (v_other, 'OTHS', 'Oth') returning id into v_style;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_other,'OM','Oth','fabric','m') returning id into v_mat;
  insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit) values (v_other, v_style, v_mat, 1.5);

  perform set_config('request.jwt.claims',
    json_build_object('sub','f1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.styles (tenant_id, code, name) values (v_tenant, 'MYS', 'My') returning id into v_style;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_tenant,'MM','Mine','fabric','m') returning id into v_mat;
  insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit) values (v_tenant, v_style, v_mat, 1.25);

  -- RLS: foreign BOM invisible
  if exists (select 1 from public.bom_lines where tenant_id = v_other) then raise exception 'RLS leak on bom_lines'; end if;
  reset role;
  raise notice 'bom_lines OK: insert + RLS';
end $$;

rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.local; set +a; npm run test:db supabase/tests/bom_issue.test.sql`
Expected: ERROR — `relation "public.bom_lines" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260710000005_bom.sql`:

```sql
create table public.bom_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  style_id uuid not null references public.styles(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty_per_unit numeric(14,4) not null check (qty_per_unit > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, style_id, material_id)
);
create index bom_lines_style_idx on public.bom_lines(style_id);

alter table public.bom_lines enable row level security;
create policy tenant_isolation on public.bom_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.bom_lines to authenticated;
```

> ponytail: like `cost_entries`, RLS validates only the row's `tenant_id`, not that `style_id`/`material_id` belong to the tenant — a caller who knows a foreign uuid could reference it. Accepted (low risk, needs the uuid); add a validating trigger only if it becomes a real vector.

- [ ] **Step 4: Apply + green**

```bash
set -a; . ./.env.local; set +a; npx supabase db push --db-url "$SUPABASE_DB_URL"
set -a; . ./.env.local; set +a; npm run test:db supabase/tests/bom_issue.test.sql
```
Expected: `RESULT: PASS`.

- [ ] **Step 5: Add type + commit**

In `src/types/database.ts` `Tables`, add:

```ts
      bom_lines: {
        Row: { id: string; tenant_id: string; style_id: string; material_id: string; qty_per_unit: number; created_at: string }
        Insert: { id?: string; tenant_id?: string; style_id: string; material_id: string; qty_per_unit: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; style_id?: string; material_id?: string; qty_per_unit?: number; created_at?: string }
        Relationships: []
      }
```

Run `npx tsc --noEmit`, then:

```bash
git add supabase/migrations/20260710000005_bom.sql supabase/tests/bom_issue.test.sql src/types/database.ts
git commit -m "feat: bom_lines table"
```

---

## Task 6: `issue_material_to_po`

**Files:**
- Create: `supabase/migrations/20260710000006_issue_material.sql`
- Modify: `supabase/tests/bom_issue.test.sql`, `src/types/database.ts`

- [ ] **Step 1: Add failing assertions to the test**

Append a `do $$ ... end $$;` block to `supabase/tests/bom_issue.test.sql`, before `rollback;`:

```sql
do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='f1111111-1111-1111-1111-111111111111');
  v_style uuid; v_mat uuid; v_loc uuid; v_vendor uuid; v_prod uuid; v_sku uuid; v_bal numeric;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','f1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_tenant,'ISS-M','IssMat','fabric','m') returning id into v_mat;
  insert into public.vendors (tenant_id, name) values (v_tenant, 'IssVend') returning id into v_vendor;
  v_style := public.create_style_with_skus('ISS-STY','IssStyle','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;
  v_prod := public.create_production_order(v_style, v_vendor, null, 'cmt',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 10)));

  -- stock the material first
  perform public.record_material_movement(v_mat, 50, 'purchase_in', null, null, null, v_loc);

  -- issue 20 → balance 30, negative issue_out row exists
  perform public.issue_material_to_po(v_prod, jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty', 20)), v_loc);
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 30 then raise exception 'expected 30 after issue, got %', v_bal; end if;
  if not exists (select 1 from public.material_ledger where material_id = v_mat and movement_type = 'issue_out' and qty = -20 and ref_id = v_prod) then
    raise exception 'issue_out row not stored as -20 with prod ref';
  end if;

  -- insufficient balance rejected (only 30 left, ask 999)
  begin
    perform public.issue_material_to_po(v_prod, jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty', 999)), v_loc);
    raise exception 'INSUF_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%insufficient%' then raise; end if;
  end;

  raise notice 'issue_material_to_po OK: negative issue, prod ref, insufficient reject';
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.local; set +a; npm run test:db supabase/tests/bom_issue.test.sql`
Expected: FAIL — `function public.issue_material_to_po(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260710000006_issue_material.sql`:

```sql
create or replace function public.issue_material_to_po(
  p_prod_po_id uuid,
  p_issues jsonb,
  p_location_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text;
  v_loc uuid;
  v_iss jsonb;
  v_mat uuid;
  v_qty numeric;
  v_bal numeric;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select code into v_code from public.production_orders where id = p_prod_po_id and tenant_id = v_tenant;
  if v_code is null then raise exception 'production order not found'; end if;

  if p_location_id is null then
    select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
    if v_loc is null then raise exception 'no default location'; end if;
  else
    if not exists (select 1 from public.locations where id = p_location_id and tenant_id = v_tenant) then
      raise exception 'location not in tenant';
    end if;
    v_loc := p_location_id;
  end if;
  if p_issues is null or jsonb_array_length(p_issues) < 1 then raise exception 'no issues'; end if;

  for v_iss in select value from jsonb_array_elements(p_issues) loop
    v_mat := (v_iss ->> 'material_id')::uuid;
    v_qty := (v_iss ->> 'qty')::numeric;
    if v_qty <= 0 then raise exception 'issue qty must be > 0'; end if;
    if not exists (select 1 from public.materials where id = v_mat and tenant_id = v_tenant) then
      raise exception 'material not in tenant';
    end if;
    select coalesce(sum(qty), 0) into v_bal from public.material_ledger
      where material_id = v_mat and location_id = v_loc;
    if v_bal < v_qty then raise exception 'insufficient material balance: have %, need %', v_bal, v_qty; end if;
    perform public.record_material_movement(v_mat, v_qty, 'issue_out', 'issue to ' || v_code, 'production_order', p_prod_po_id, v_loc);
  end loop;
end;
$$;

grant execute on function public.issue_material_to_po(uuid, jsonb, uuid) to authenticated;
```

- [ ] **Step 4: Apply + green**

```bash
set -a; . ./.env.local; set +a; npx supabase db push --db-url "$SUPABASE_DB_URL"
set -a; . ./.env.local; set +a; npm run test:db supabase/tests/bom_issue.test.sql
```
Expected: `RESULT: PASS`, notice `issue_material_to_po OK: ...`.

- [ ] **Step 5: Add type + commit**

In `src/types/database.ts` `Functions`, add:

```ts
      issue_material_to_po: {
        Args: { p_prod_po_id: string; p_issues: Json; p_location_id?: string | null }
        Returns: undefined
      }
```

Run `npx tsc --noEmit`, then:

```bash
git add supabase/migrations/20260710000006_issue_material.sql supabase/tests/bom_issue.test.sql src/types/database.ts
git commit -m "feat: issue_material_to_po (material out to production order)"
```

---

## Task 7: `suggestIssue` pure logic + vitest

**Files:**
- Create: `src/lib/bom/suggest.ts`, `src/lib/bom/suggest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/bom/suggest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { suggestIssue } from './suggest'

describe('suggestIssue', () => {
  it('multiplies qty_per_unit by total units per material', () => {
    const bom = [
      { material_id: 'a', qty_per_unit: 1.25 },
      { material_id: 'b', qty_per_unit: 0.5 },
    ]
    expect(suggestIssue(bom, 10)).toEqual([
      { material_id: 'a', qty: 12.5 },
      { material_id: 'b', qty: 5 },
    ])
  })

  it('returns empty for an empty BOM', () => {
    expect(suggestIssue([], 100)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bom/suggest.test.ts`
Expected: FAIL — cannot resolve `./suggest`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bom/suggest.ts`:

```ts
export type BomLine = { material_id: string; qty_per_unit: number }
export type IssueSuggestion = { material_id: string; qty: number }

// Suggested issue quantity per material = qty_per_unit * total units on the
// production order. Caller can edit before issuing.
export function suggestIssue(bom: BomLine[], totalUnits: number): IssueSuggestion[] {
  return bom.map((b) => ({ material_id: b.material_id, qty: b.qty_per_unit * totalUnits }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bom/suggest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bom/suggest.ts src/lib/bom/suggest.test.ts
git commit -m "feat: suggestIssue BOM quantity helper + tests"
```

---

## Task 8: Material stock page + adjust + nav

**Files:**
- Create: `src/lib/materials/stock.ts`, `src/app/(app)/material-stock/page.tsx`, `src/app/(app)/material-stock/MaterialAdjustForm.tsx`
- Modify: `src/lib/ui.ts`, `src/components/SideNav.tsx`

- [ ] **Step 1: Add material movement badge meta**

In `src/lib/ui.ts`, add (after `MOVEMENT_META`):

```ts
export const MATERIAL_MOVEMENT_META: Record<string, { label: string; c: string; bg: string }> = {
  purchase_in: { label: 'Pembelian Masuk', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
  issue_out: { label: 'Keluar ke Vendor', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
  adjustment: { label: 'Penyesuaian', c: '#cdc6b8', bg: 'rgba(205,198,184,.13)' },
  transfer_in: { label: 'Transfer Masuk', c: '#9fc0e8', bg: 'rgba(159,192,232,.13)' },
  transfer_out: { label: 'Transfer Keluar', c: '#eda06a', bg: 'rgba(237,160,106,.13)' },
}
```

- [ ] **Step 2: Write the adjust server action**

Create `src/lib/materials/stock.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function recordMaterialAdjustment(input: {
  material_id: string; qty: number; reason: string; location_id?: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('record_material_movement', {
    p_material_id: input.material_id,
    p_qty: input.qty,
    p_movement_type: 'adjustment',
    p_reason: input.reason,
    p_location_id: input.location_id ?? undefined,
  })
  if (error) return { error: error.message }
  revalidatePath('/material-stock')
}
```

- [ ] **Step 3: Write the adjust form**

Create `src/app/(app)/material-stock/MaterialAdjustForm.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordMaterialAdjustment } from '@/lib/materials/stock'

type MatOption = { id: string; code: string; name: string }
type LocOption = { id: string; name: string }

export default function MaterialAdjustForm({ materials, locations }: { materials: MatOption[]; locations: LocOption[] }) {
  const router = useRouter()
  const [matId, setMatId] = useState('')
  const [locId, setLocId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    const n = Number(qty)
    if (!matId) { setError('Pilih bahan'); return }
    if (!Number.isFinite(n) || n === 0) { setError('Qty harus angka bukan nol'); return }
    if (!reason.trim()) { setError('Alasan wajib diisi'); return }
    setSaving(true)
    const res = await recordMaterialAdjustment({ material_id: matId, qty: n, reason: reason.trim(), location_id: locId || undefined })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setQty(''); setReason(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>Penyesuaian Stok Bahan</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 90px 1.3fr auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label className="vb-label">Bahan</label>
          <select className="vb-input" value={matId} onChange={(e) => setMatId(e.target.value)}>
            <option value="">Pilih bahan…</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Lokasi</label>
          <select className="vb-input" value={locId} onChange={(e) => setLocId(e.target.value)}>
            <option value="">Default</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Qty (±)</label>
          <input className="vb-input" placeholder="-5" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className="vb-label">Alasan</label>
          <input className="vb-input" placeholder="Opname bahan" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ height: 37 }}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write the page**

Create `src/app/(app)/material-stock/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import MaterialAdjustForm from './MaterialAdjustForm'
import { MATERIAL_MOVEMENT_META } from '@/lib/ui'

export default async function MaterialStockPage() {
  const supabase = await createClient()

  const { data: materials } = await supabase.from('materials').select('id, code, name').order('code')
  const { data: locations } = await supabase.from('locations').select('id, name').eq('active', true).order('name')
  const { data: byLoc } = await supabase.from('material_balances_by_location').select('material_id, location_id, balance')
  const { data: movements } = await supabase
    .from('material_ledger')
    .select('id, material_id, location_id, qty, movement_type, reason, created_at')
    .order('created_at', { ascending: false }).limit(20)

  const matOf = new Map((materials ?? []).map((m) => [m.id, `${m.code}`]))
  const locName = new Map((locations ?? []).map((l) => [l.id, l.name]))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Stok Bahan</h1>
        <div className="vb-sub">{byLoc?.length ?? 0} saldo bahan × lokasi</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.7fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Saldo per Lokasi</div>
          <div className="vb-thead" style={{ gridTemplateColumns: '1fr 1fr 80px' }}>
            <div>Bahan</div><div>Lokasi</div><div style={{ textAlign: 'right' }}>Saldo</div>
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {!byLoc?.length ? (
              <div className="vb-empty">Belum ada stok bahan.</div>
            ) : byLoc.map((b) => (
              <div key={`${b.material_id}-${b.location_id}`} className="vb-row" style={{ gridTemplateColumns: '1fr 1fr 80px' }}>
                <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{matOf.get(b.material_id ?? '') ?? b.material_id}</div>
                <div className="vb-muted" style={{ fontSize: 12.5 }}>{locName.get(b.location_id ?? '') ?? '—'}</div>
                <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600, color: (b.balance ?? 0) < 0 ? 'var(--vb-danger)' : 'var(--vb-text)' }}>{b.balance}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MaterialAdjustForm materials={materials ?? []} locations={locations ?? []} />
          <div className="vb-card" style={{ overflow: 'hidden' }}>
            <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Pergerakan Terakhir</div>
            <div className="vb-thead" style={{ gridTemplateColumns: '1.2fr 130px 70px 1fr 1.2fr' }}>
              <div>Bahan</div><div>Tipe</div><div style={{ textAlign: 'right' }}>Qty</div><div>Lokasi</div><div>Alasan</div>
            </div>
            {!movements?.length ? (
              <div className="vb-empty">Belum ada pergerakan.</div>
            ) : movements.map((m) => {
              const meta = MATERIAL_MOVEMENT_META[m.movement_type] ?? { label: m.movement_type, c: 'var(--vb-muted)', bg: 'transparent' }
              return (
                <div key={m.id} className="vb-row" style={{ gridTemplateColumns: '1.2fr 130px 70px 1fr 1.2fr' }}>
                  <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{matOf.get(m.material_id) ?? m.material_id}</div>
                  <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
                  <div className="vb-mono" style={{ textAlign: 'right', fontWeight: 600, color: Number(m.qty) < 0 ? 'var(--vb-danger)' : '#93d6a1' }}>{m.qty}</div>
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

- [ ] **Step 5: Add nav**

In `src/components/SideNav.tsx`, add a new group to `GROUPS` (after the Penjualan group, before Pengaturan):

```tsx
  { title: 'Pembelian', items: [{ label: 'Pembelian', href: '/purchasing' }, { label: 'Stok Bahan', href: '/material-stock' }] },
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/lib/materials/stock.ts src/lib/ui.ts src/components/SideNav.tsx src/app/\(app\)/material-stock
git commit -m "feat: material stock page + adjust + nav"
```

---

## Task 9: Purchasing list + create page

**Files:**
- Create: `src/lib/purchasing/actions.ts`, `src/app/(app)/purchasing/page.tsx`, `src/app/(app)/purchasing/PurchaseForm.tsx`

- [ ] **Step 1: Write the server actions**

Create `src/lib/purchasing/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type PurchaseLineInput = { material_id: string; qty_ordered: number; unit_price: number }

export async function createPurchaseOrder(input: {
  vendor_id: string; location_id?: string; order_date?: string; notes: string; lines: PurchaseLineInput[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_vendor_id: input.vendor_id,
    p_location_id: input.location_id ?? null,
    p_order_date: input.order_date ?? null,
    p_notes: input.notes,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/purchasing/${data}`)
}

export async function receivePurchase(input: {
  po_id: string; receipts: { line_id: string; qty: number }[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('receive_purchase', { p_po_id: input.po_id, p_receipts: input.receipts })
  if (error) return { error: error.message }
  revalidatePath(`/purchasing/${input.po_id}`)
}
```

- [ ] **Step 2: Write the create form**

Create `src/app/(app)/purchasing/PurchaseForm.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { createPurchaseOrder, type PurchaseLineInput } from '@/lib/purchasing/actions'

type VendorOption = { id: string; name: string }
type MatOption = { id: string; code: string; name: string }
type LocOption = { id: string; name: string }
type Row = { material_id: string; qty_ordered: string; unit_price: string }

export default function PurchaseForm({ vendors, materials, locations }: { vendors: VendorOption[]; materials: MatOption[]; locations: LocOption[] }) {
  const [vendorId, setVendorId] = useState('')
  const [locId, setLocId] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Row[]>([{ material_id: '', qty_ordered: '', unit_price: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function onSave() {
    setError(null)
    if (!vendorId) { setError('Pilih vendor'); return }
    const lines: PurchaseLineInput[] = []
    for (const r of rows) {
      if (!r.material_id) continue
      const q = Number(r.qty_ordered), p = Number(r.unit_price || '0')
      if (!Number.isFinite(q) || q <= 0) { setError('Qty tiap baris harus > 0'); return }
      lines.push({ material_id: r.material_id, qty_ordered: q, unit_price: Number.isFinite(p) ? p : 0 })
    }
    if (!lines.length) { setError('Minimal satu baris bahan'); return }
    setSaving(true)
    const res = await createPurchaseOrder({ vendor_id: vendorId, location_id: locId || undefined, notes: notes.trim(), lines })
    setSaving(false)
    if (res?.error) { setError(res.error); setSaving(false) }
    // success → server action redirects
  }

  return (
    <div className="vb-card" style={{ padding: 18 }}>
      <div className="vb-cardtitle" style={{ marginBottom: 12 }}>PO Bahan Baru</div>
      {error && <div className="vb-danger" style={{ marginBottom: 8, fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label className="vb-label">Vendor</label>
          <select className="vb-input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Pilih vendor…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Terima di lokasi</label>
          <select className="vb-input" value={locId} onChange={(e) => setLocId(e.target.value)}>
            <option value="">Default</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      <label className="vb-label">Baris bahan</label>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 120px 30px', gap: 8, marginBottom: 6 }}>
          <select className="vb-input" value={r.material_id} onChange={(e) => setRow(i, { material_id: e.target.value })}>
            <option value="">Pilih bahan…</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
          <input className="vb-input" placeholder="Qty" value={r.qty_ordered} onChange={(e) => setRow(i, { qty_ordered: e.target.value })} />
          <input className="vb-input" placeholder="Harga/unit" value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })} />
          <button type="button" className="vb-btn" style={{ padding: 0 }} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1}>×</button>
        </div>
      ))}
      <button type="button" className="vb-btn" style={{ marginTop: 4, marginBottom: 12 }}
        onClick={() => setRows((rs) => [...rs, { material_id: '', qty_ordered: '', unit_price: '' }])}>+ Baris</button>

      <div>
        <label className="vb-label">Catatan</label>
        <input className="vb-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave} style={{ marginTop: 12, alignSelf: 'flex-end' }}>
        {saving ? 'Menyimpan…' : 'Buat PO'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2b: Write the list page**

Create `src/app/(app)/purchasing/page.tsx`:

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PurchaseForm from './PurchaseForm'

const STATUS_META: Record<string, { label: string; c: string; bg: string }> = {
  open: { label: 'Terbuka', c: '#e3c46e', bg: 'rgba(227,196,110,.13)' },
  received: { label: 'Diterima', c: '#93d6a1', bg: 'rgba(147,214,161,.13)' },
  canceled: { label: 'Batal', c: '#ff9b9b', bg: 'rgba(255,155,155,.13)' },
}

export default async function PurchasingPage() {
  const supabase = await createClient()
  const { data: pos } = await supabase.from('purchase_orders').select('id, code, vendor_id, status, order_date').order('created_at', { ascending: false })
  const { data: vendors } = await supabase.from('vendors').select('id, name').eq('active', true).order('name')
  const { data: materials } = await supabase.from('materials').select('id, code, name').eq('active', true).order('code')
  const { data: locations } = await supabase.from('locations').select('id, name').eq('active', true).order('name')
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="vb-h1">Pembelian</h1>
        <div className="vb-sub">{pos?.length ?? 0} PO bahan</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          <div className="vb-thead" style={{ gridTemplateColumns: '1.1fr 1.4fr 110px 110px' }}>
            <div>Kode</div><div>Vendor</div><div>Tanggal</div><div>Status</div>
          </div>
          {!pos?.length ? (
            <div className="vb-empty">Belum ada PO.</div>
          ) : pos.map((p) => {
            const meta = STATUS_META[p.status] ?? { label: p.status, c: 'var(--vb-muted)', bg: 'transparent' }
            return (
              <Link key={p.id} href={`/purchasing/${p.id}`} className="vb-row vb-rowlink" style={{ gridTemplateColumns: '1.1fr 1.4fr 110px 110px' }}>
                <div className="vb-mono" style={{ fontWeight: 500, fontSize: 12.5 }}>{p.code}</div>
                <div style={{ fontSize: 12.5 }}>{vendorName.get(p.vendor_id) ?? '—'}</div>
                <div className="vb-muted" style={{ fontSize: 12.5 }}>{p.order_date}</div>
                <div><span className="vb-badge" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span></div>
              </Link>
            )
          })}
        </div>
        <PurchaseForm vendors={vendors ?? []} materials={materials ?? []} locations={locations ?? []} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/lib/purchasing/actions.ts src/app/\(app\)/purchasing/page.tsx src/app/\(app\)/purchasing/PurchaseForm.tsx
git commit -m "feat: purchasing list + create PO page"
```

---

## Task 10: Purchase detail + receive

**Files:**
- Create: `src/app/(app)/purchasing/[id]/page.tsx`, `src/app/(app)/purchasing/[id]/ReceiveForm.tsx`

- [ ] **Step 1: Write the receive form**

Create `src/app/(app)/purchasing/[id]/ReceiveForm.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { receivePurchase } from '@/lib/purchasing/actions'

type Line = { id: string; material_code: string; qty_ordered: number; unit_price: number; qty_received: number }

export default function ReceiveForm({ poId, lines, disabled }: { poId: string; lines: Line[]; disabled: boolean }) {
  const router = useRouter()
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onReceive() {
    setError(null)
    const receipts: { line_id: string; qty: number }[] = []
    for (const l of lines) {
      const raw = qtys[l.id]
      if (!raw || !raw.trim()) continue
      const q = Number(raw)
      if (!Number.isFinite(q) || q <= 0) { setError('Qty terima harus > 0'); return }
      const remaining = l.qty_ordered - l.qty_received
      if (q > remaining) { setError(`Qty terima ${l.material_code} melebihi sisa ${remaining}`); return }
      receipts.push({ line_id: l.id, qty: q })
    }
    if (!receipts.length) { setError('Isi minimal satu qty terima'); return }
    setSaving(true)
    const res = await receivePurchase({ po_id: poId, receipts })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setQtys({}); router.refresh()
  }

  return (
    <div className="vb-card" style={{ overflow: 'hidden' }}>
      <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Penerimaan</div>
      {error && <div className="vb-danger" style={{ margin: '0 16px 8px', fontSize: 12.5 }}>{error}</div>}
      <div className="vb-thead" style={{ gridTemplateColumns: '1.4fr 90px 90px 90px 110px' }}>
        <div>Bahan</div><div style={{ textAlign: 'right' }}>Order</div><div style={{ textAlign: 'right' }}>Diterima</div><div style={{ textAlign: 'right' }}>Sisa</div><div>Terima</div>
      </div>
      {lines.map((l) => {
        const remaining = l.qty_ordered - l.qty_received
        return (
          <div key={l.id} className="vb-row" style={{ gridTemplateColumns: '1.4fr 90px 90px 90px 110px', alignItems: 'center' }}>
            <div className="vb-mono" style={{ fontSize: 12.5 }}>{l.material_code}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{l.qty_ordered}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{l.qty_received}</div>
            <div className="vb-mono" style={{ textAlign: 'right' }}>{remaining}</div>
            <input className="vb-input" style={{ height: 30, textAlign: 'right' }} disabled={disabled || remaining <= 0}
              placeholder={String(remaining)} value={qtys[l.id] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [l.id]: e.target.value }))} />
          </div>
        )
      })}
      {!disabled && (
        <div style={{ padding: 12 }}>
          <button className="vb-btn" type="button" disabled={saving} onClick={onReceive}>{saving ? 'Memproses…' : 'Terima Bahan'}</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write the detail page**

Create `src/app/(app)/purchasing/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReceiveForm from './ReceiveForm'
import { rp } from '@/lib/ui'

export default async function PurchaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: po } = await supabase.from('purchase_orders').select('*').eq('id', id).single()
  if (!po) notFound()

  const { data: lines } = await supabase.from('purchase_lines').select('id, material_id, qty_ordered, unit_price, qty_received').eq('po_id', id)
  const matIds = (lines ?? []).map((l) => l.material_id)
  const { data: materials } = await supabase.from('materials').select('id, code').in('id', matIds.length ? matIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((materials ?? []).map((m) => [m.id, m.code]))
  const { data: vendor } = await supabase.from('vendors').select('name').eq('id', po.vendor_id).single()

  const formLines = (lines ?? []).map((l) => ({
    id: l.id, material_code: codeOf.get(l.material_id) ?? l.material_id,
    qty_ordered: Number(l.qty_ordered), unit_price: Number(l.unit_price), qty_received: Number(l.qty_received),
  }))
  const total = formLines.reduce((s, l) => s + l.qty_ordered * l.unit_price, 0)

  return (
    <div>
      <Link href="/purchasing" className="vb-back">← Pembelian</Link>
      <div style={{ marginBottom: 16 }}>
        <h1 className="vb-h1">{po.code}</h1>
        <div className="vb-sub">{vendor?.name ?? '—'} · {po.order_date} · {po.status}{po.notes ? ` · ${po.notes}` : ''}</div>
      </div>
      <div style={{ marginBottom: 12, fontSize: 13 }} className="vb-muted">Nilai PO: <span className="vb-mono">{rp(total)}</span></div>
      <ReceiveForm poId={po.id} lines={formLines} disabled={po.status === 'canceled' || po.status === 'received'} />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/app/\(app\)/purchasing/\[id\]
git commit -m "feat: purchase detail + partial receive"
```

---

## Task 11: BOM section on style detail

**Files:**
- Create: `src/lib/bom/actions.ts`, `src/app/(app)/styles/[id]/BomSection.tsx`
- Modify: `src/app/(app)/styles/[id]/page.tsx`

- [ ] **Step 1: Write the BOM actions**

Create `src/lib/bom/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addBomLine(input: {
  style_id: string; material_id: string; qty_per_unit: number
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('bom_lines').insert({
    style_id: input.style_id, material_id: input.material_id, qty_per_unit: input.qty_per_unit,
  })
  if (error) return { error: error.message }
  revalidatePath(`/styles/${input.style_id}`)
}

export async function removeBomLine(id: string, styleId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.from('bom_lines').delete().eq('id', id)
  revalidatePath(`/styles/${styleId}`)
}
```

- [ ] **Step 2: Write the BOM section component**

Create `src/app/(app)/styles/[id]/BomSection.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addBomLine, removeBomLine } from '@/lib/bom/actions'

type MatOption = { id: string; code: string; name: string }
type BomRow = { id: string; material_id: string; qty_per_unit: number }

export default function BomSection({ styleId, materials, rows }: { styleId: string; materials: MatOption[]; rows: BomRow[] }) {
  const router = useRouter()
  const [matId, setMatId] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const codeOf = new Map(materials.map((m) => [m.id, `${m.code} · ${m.name}`]))

  async function onAdd() {
    setError(null)
    const n = Number(qty)
    if (!matId) { setError('Pilih bahan'); return }
    if (!Number.isFinite(n) || n <= 0) { setError('Qty/unit harus > 0'); return }
    setSaving(true)
    const res = await addBomLine({ style_id: styleId, material_id: matId, qty_per_unit: n })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setMatId(''); setQty(''); router.refresh()
  }

  async function onRemove(id: string) {
    await removeBomLine(id, styleId); router.refresh()
  }

  return (
    <div className="vb-card" style={{ overflow: 'hidden', marginTop: 12 }}>
      <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>BOM (Bahan per Unit)</div>
      {error && <div className="vb-danger" style={{ margin: '0 16px 8px', fontSize: 12.5 }}>{error}</div>}
      <div className="vb-thead" style={{ gridTemplateColumns: '1.6fr 120px 60px' }}>
        <div>Bahan</div><div style={{ textAlign: 'right' }}>Qty/unit</div><div></div>
      </div>
      {!rows.length ? (
        <div className="vb-empty">Belum ada BOM.</div>
      ) : rows.map((r) => (
        <div key={r.id} className="vb-row" style={{ gridTemplateColumns: '1.6fr 120px 60px', alignItems: 'center' }}>
          <div style={{ fontSize: 12.5 }}>{codeOf.get(r.material_id) ?? r.material_id}</div>
          <div className="vb-mono" style={{ textAlign: 'right' }}>{r.qty_per_unit}</div>
          <button type="button" className="vb-btn" style={{ padding: '2px 8px' }} onClick={() => onRemove(r.id)}>×</button>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 120px auto', gap: 8, padding: 12, alignItems: 'end' }}>
        <div>
          <label className="vb-label">Bahan</label>
          <select className="vb-input" value={matId} onChange={(e) => setMatId(e.target.value)}>
            <option value="">Pilih bahan…</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="vb-label">Qty/unit</label>
          <input className="vb-input" placeholder="1.25" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <button className="vb-btn" type="button" disabled={saving} onClick={onAdd} style={{ height: 37 }}>{saving ? '…' : 'Tambah'}</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount on the style detail page**

Read `src/app/(app)/styles/[id]/page.tsx` first. Add these fetches after the existing data loads (inside the async component, using the already-available `supabase` and the style `id`):

```tsx
  const { data: bomRows } = await supabase.from('bom_lines').select('id, material_id, qty_per_unit').eq('style_id', id)
  const { data: allMaterials } = await supabase.from('materials').select('id, code, name').eq('active', true).order('code')
```

Then render the section near the end of the returned JSX (before the closing wrapper `</div>`), passing `Number(r.qty_per_unit)`:

```tsx
      <BomSection
        styleId={id}
        materials={allMaterials ?? []}
        rows={(bomRows ?? []).map((r) => ({ id: r.id, material_id: r.material_id, qty_per_unit: Number(r.qty_per_unit) }))}
      />
```

Add the import at the top: `import BomSection from './BomSection'`.

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/lib/bom/actions.ts src/app/\(app\)/styles/\[id\]/BomSection.tsx src/app/\(app\)/styles/\[id\]/page.tsx
git commit -m "feat: BOM editor on style detail"
```

---

## Task 12: Issue section on production detail

**Files:**
- Create: `src/lib/production/issue.ts`, `src/app/(app)/production/[id]/IssueSection.tsx`
- Modify: `src/app/(app)/production/[id]/page.tsx`

- [ ] **Step 1: Write the issue action**

Create `src/lib/production/issue.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function issueMaterialToPo(input: {
  prod_po_id: string; issues: { material_id: string; qty: number }[]; location_id?: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('issue_material_to_po', {
    p_prod_po_id: input.prod_po_id,
    p_issues: input.issues,
    p_location_id: input.location_id ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/production/${input.prod_po_id}`)
}
```

- [ ] **Step 2: Write the issue section component**

Create `src/app/(app)/production/[id]/IssueSection.tsx`. It receives BOM-suggested quantities (computed server-side via `suggestIssue`) and lets the user edit before issuing:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { issueMaterialToPo } from '@/lib/production/issue'

type Suggestion = { material_id: string; material_code: string; qty: number }
type LocOption = { id: string; name: string }

export default function IssueSection({ prodPoId, suggestions, locations }: { prodPoId: string; suggestions: Suggestion[]; locations: LocOption[] }) {
  const router = useRouter()
  const [locId, setLocId] = useState('')
  const [qtys, setQtys] = useState<Record<string, string>>(
    Object.fromEntries(suggestions.map((s) => [s.material_id, String(s.qty)])),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onIssue() {
    setError(null)
    const issues: { material_id: string; qty: number }[] = []
    for (const s of suggestions) {
      const raw = qtys[s.material_id]
      if (!raw || !raw.trim()) continue
      const q = Number(raw)
      if (!Number.isFinite(q) || q <= 0) { setError(`Qty ${s.material_code} tidak valid`); return }
      issues.push({ material_id: s.material_id, qty: q })
    }
    if (!issues.length) { setError('Isi minimal satu qty'); return }
    setSaving(true)
    const res = await issueMaterialToPo({ prod_po_id: prodPoId, issues, location_id: locId || undefined })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    router.refresh()
  }

  return (
    <div className="vb-card" style={{ overflow: 'hidden', marginTop: 12 }}>
      <div className="vb-cardtitle" style={{ padding: '14px 16px 10px' }}>Issue Bahan ke Vendor (CMT)</div>
      {error && <div className="vb-danger" style={{ margin: '0 16px 8px', fontSize: 12.5 }}>{error}</div>}
      {!suggestions.length ? (
        <div className="vb-empty">Style ini belum punya BOM — tambah di halaman style bila CMT.</div>
      ) : (
        <>
          <div style={{ padding: '0 16px 10px', maxWidth: 260 }}>
            <label className="vb-label">Ambil dari lokasi</label>
            <select className="vb-input" value={locId} onChange={(e) => setLocId(e.target.value)}>
              <option value="">Default</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="vb-thead" style={{ gridTemplateColumns: '1.6fr 130px' }}>
            <div>Bahan</div><div style={{ textAlign: 'right' }}>Qty issue (saran BOM)</div>
          </div>
          {suggestions.map((s) => (
            <div key={s.material_id} className="vb-row" style={{ gridTemplateColumns: '1.6fr 130px', alignItems: 'center' }}>
              <div className="vb-mono" style={{ fontSize: 12.5 }}>{s.material_code}</div>
              <input className="vb-input" style={{ height: 30, textAlign: 'right' }}
                value={qtys[s.material_id] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [s.material_id]: e.target.value }))} />
            </div>
          ))}
          <div style={{ padding: 12 }}>
            <button className="vb-btn" type="button" disabled={saving} onClick={onIssue}>{saving ? 'Memproses…' : 'Issue Bahan'}</button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Mount on the production detail page**

Read `src/app/(app)/production/[id]/page.tsx` first. Add after the existing data loads (the page already has `po`, `lines` for `prod_lines`, and `supabase`):

```tsx
  const { data: bomRows } = await supabase.from('bom_lines').select('material_id, qty_per_unit').eq('style_id', po.style_id)
  const bomMatIds = (bomRows ?? []).map((b) => b.material_id)
  const { data: bomMaterials } = await supabase.from('materials').select('id, code').in('id', bomMatIds.length ? bomMatIds : ['00000000-0000-0000-0000-000000000000'])
  const { data: issueLocations } = await supabase.from('locations').select('id, name').eq('active', true).order('name')
  const bomCodeOf = new Map((bomMaterials ?? []).map((m) => [m.id, m.code]))
  const totalUnits = (lines ?? []).reduce((s, l) => s + Number(l.qty_ordered), 0)
  const suggestions = suggestIssue(
    (bomRows ?? []).map((b) => ({ material_id: b.material_id, qty_per_unit: Number(b.qty_per_unit) })),
    totalUnits,
  ).map((s) => ({ material_id: s.material_id, material_code: bomCodeOf.get(s.material_id) ?? s.material_id, qty: s.qty }))
```

Add imports at the top:
```tsx
import IssueSection from './IssueSection'
import { suggestIssue } from '@/lib/bom/suggest'
```

Render the section near the end of the returned JSX (before the closing wrapper):

```tsx
      <IssueSection prodPoId={po.id} suggestions={suggestions} locations={issueLocations ?? []} />
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/lib/production/issue.ts src/app/\(app\)/production/\[id\]/IssueSection.tsx src/app/\(app\)/production/\[id\]/page.tsx
git commit -m "feat: issue material to production order (BOM-suggested)"
```

---

## Task 13: E2E purchase → receive + regression gate

**Files:**
- Create: `e2e/purchasing.spec.ts`

- [ ] **Step 1: Inspect existing specs**

Read `e2e/transfer.spec.ts` (from Fase A) and one other spec to reuse the login/auth helper, base URL (port 3100), and `.vb-*` selector conventions. Do not invent a new login flow.

- [ ] **Step 2: Write the E2E**

Create `e2e/purchasing.spec.ts` following that structure. Flow:
1. Log in (reuse helper).
2. Ensure a material exists: go to `/materials`, add one (e.g. code `E2E-FAB`, Kain, `m`) if absent.
3. Ensure a vendor exists: go to `/vendors`, add one if absent.
4. Go to `/purchasing`, create a PO: pick the vendor, add a line (the material, qty 100, price 15000), submit → lands on the PO detail page.
5. On the detail page, receive a partial qty (e.g. 40) for the line, submit.
6. Assert the line now shows `Diterima 40` (qty_received) and `Sisa 60`.
7. Go to `/material-stock` and assert the material shows a balance of 40.

Write actual selectors/assertions matching the existing specs' conventions (scope selectors to their `.vb-card` to avoid collisions, generous timeouts for dev cold-compile as `transfer.spec.ts` does).

- [ ] **Step 3: Run the E2E**

Run: `npm run e2e -- purchasing.spec.ts`
Expected: PASS.

- [ ] **Step 4: Full regression gate**

```bash
set -a; . ./.env.local; set +a; npm run test:db supabase/tests/stock_ledger.test.sql supabase/tests/stock_location.test.sql supabase/tests/locations.test.sql supabase/tests/materials.test.sql supabase/tests/material_ledger.test.sql supabase/tests/purchasing.test.sql supabase/tests/bom_issue.test.sql
npm run test
```
Expected: all `RESULT: PASS`, vitest green.

- [ ] **Step 5: Commit**

```bash
git add e2e/purchasing.spec.ts
git commit -m "test: E2E purchase order → partial receive → material stock"
```

---

## Done criteria

- `material_ledger` append-only, decimal, location-aware; `record_material_movement` the sole writer with correct signs (`issue_out`/`transfer_out` negative).
- Purchasing: create PO with lines; partial receipts post `purchase_in` and update `qty_received`; over-receipt rejected; full receipt flips status to `received`.
- BOM editable per style; `suggestIssue` computes issue quantities.
- `issue_material_to_po` posts negative `issue_out` against a production order, rejects overdraw.
- UI: Stok Bahan, Pembelian (list + create + detail/receive), BOM section on style, Issue section on production order. Maklon orders simply skip issuing.
- Green: `npm run test`, all seven DB test files, `purchasing.spec.ts`.

## Not in Fase B (carried forward)

- AP bill/payment for received POs → Fase C.
- Material valuation → finished-goods HPP → deferred.
- Inter-warehouse material transfer, material opname grid, WIP-at-vendor tracking → later, if the simulation surfaces the need.
