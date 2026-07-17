# RBAC Penjualan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict order/channel/return writes to `owner`/`sales`; hide the Penjualan menu from roles without access (production/inventory/viewer); keep reads tenant-wide.

**Architecture:** Same pattern as the merged Catalog/Produksi RBAC increments — role guards inside the two write RPCs (`create_order`, `create_return`), RESTRICTIVE per-command write-RLS on `orders`/`order_lines`/`returns`/`return_lines`/`channels`, UI write-control gating via `canWriteSales`, sidebar visibility gating. Spec: `docs/superpowers/specs/2026-07-17-rbac-penjualan-design.md`.

**Tech Stack:** Next.js App Router + Supabase (Postgres, RLS, plpgsql), pgTAP via `scripts/pgtap.mjs`.

## Global Constraints

- Write role set (all five surfaces): `owner,sales`. View-only (menu + read-only pages) adds `ops,finance`.
- JWT role claim key is `user_role`. Fail-CLOSED: plpgsql `coalesce(v_role not in (...), true)` (NULL → raise); RLS strict `(auth.jwt()->>'user_role') in (...)` (NULL → deny). NEVER a `coalesce(..., 'owner')` fail-open fallback.
- READ never restricted: leave every `tenant_isolation` (SELECT) policy untouched; add only per-command WRITE policies (`for insert`/`for update`/`for delete`), NEVER `for all`. Restrictive policy names unique per table per command: `sales_write_insert`/`sales_write_update`/`sales_write_delete`.
- Migration `supabase/migrations/20260717000007_rbac_penjualan.sql`, pushed via `npx supabase db push --db-url "$SUPABASE_DB_URL"` (SUPABASE_DB_URL from `.env.local`, no Docker).
- No new demo accounts (sales already seeded).
- Dev server port 3100 via preview tool; UI Bahasa Indonesia, `vb-*` classes; fresh browser tab per login, submit via `document.querySelector('form').requestSubmit()` if a click doesn't redirect.
- Commit after each task.

---

### Task 1: Migration — fn guards + RLS write-gates

**Files:**
- Create: `supabase/migrations/20260717000007_rbac_penjualan.sql`

**Interfaces:**
- Produces: `create_order` + `create_return` reject non-`owner`/`sales` callers; `orders`/`order_lines`/`returns`/`return_lines`/`channels` reject writes from other roles at RLS; SELECTs unchanged.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260717000007_rbac_penjualan.sql`:

```sql
-- RBAC Penjualan increment: gate order/channel/return writes to owner/sales.
-- READ stays tenant-wide (channels referenced by orders; orders/returns read by
-- finance reports). Fail-closed: missing user_role claim denies.

-- (1) guard the two sales RPCs (create_or_replace preserves existing grants)
create or replace function public.create_order(
  p_channel_id uuid,
  p_order_date date,
  p_customer text,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_order uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
  v_qty int;
  v_line_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','sales'), true) then
    raise exception 'hanya role Sales/Owner yang boleh membuat order';
  end if;
  if not exists (select 1 from public.channels where id = p_channel_id and tenant_id = v_tenant) then
    raise exception 'channel not in tenant';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then
    raise exception 'at least one line required';
  end if;

  insert into public.orders (tenant_id, code, channel_id, order_date, customer, notes)
  values (v_tenant, v_code, p_channel_id, coalesce(p_order_date, current_date),
          nullif(trim(p_customer), ''), nullif(trim(p_notes), ''))
  returning id into v_order;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_sku := (v_line ->> 'sku_id')::uuid;
    v_qty := (v_line ->> 'qty')::int;
    select tenant_id into v_sku_tenant from public.skus where id = v_sku;
    if v_sku_tenant is null or v_sku_tenant <> v_tenant then raise exception 'sku not in tenant'; end if;
    if v_qty <= 0 then raise exception 'qty must be > 0'; end if;
    insert into public.order_lines (tenant_id, order_id, sku_id, qty, unit_price)
    values (v_tenant, v_order, v_sku, v_qty, coalesce((v_line ->> 'unit_price')::numeric, 0))
    returning id into v_line_id;
    perform public.record_movement(v_sku, v_qty, 'sale_out', null, 'order_line', v_line_id);
  end loop;

  return v_order;
end; $$;

create or replace function public.create_return(
  p_order_id uuid,
  p_return_date date,
  p_reason text,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'RET-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_return uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
  v_qty int;
  v_line_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','sales'), true) then
    raise exception 'hanya role Sales/Owner yang boleh membuat retur';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id and tenant_id = v_tenant) then
    raise exception 'order not in tenant';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then
    raise exception 'at least one line required';
  end if;

  insert into public.returns (tenant_id, code, order_id, return_date, reason, notes)
  values (v_tenant, v_code, p_order_id, coalesce(p_return_date, current_date),
          nullif(trim(p_reason), ''), nullif(trim(p_notes), ''))
  returning id into v_return;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_sku := (v_line ->> 'sku_id')::uuid;
    v_qty := (v_line ->> 'qty')::int;
    select tenant_id into v_sku_tenant from public.skus where id = v_sku;
    if v_sku_tenant is null or v_sku_tenant <> v_tenant then raise exception 'sku not in tenant'; end if;
    if v_qty <= 0 then raise exception 'qty must be > 0'; end if;
    insert into public.return_lines (tenant_id, return_id, sku_id, qty)
    values (v_tenant, v_return, v_sku, v_qty)
    returning id into v_line_id;
    perform public.record_movement(v_sku, v_qty, 'return_in', null, 'return_line', v_line_id);
  end loop;

  return v_return;
end; $$;

-- (2) RESTRICTIVE write-gates -> owner/sales on all five tables
create policy sales_write_insert on public.orders as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.orders as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.orders as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));

create policy sales_write_insert on public.order_lines as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.order_lines as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.order_lines as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));

create policy sales_write_insert on public.returns as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.returns as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.returns as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));

create policy sales_write_insert on public.return_lines as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.return_lines as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.return_lines as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));

create policy sales_write_insert on public.channels as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.channels as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.channels as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260717000007_rbac_penjualan.sql
git commit -m "feat: RBAC penjualan write-gates (fn guards + orders/returns/channels RLS)"
```

Do NOT push yet — Task 2 pushes + tests.

---

### Task 2: Push + pgTAP + fix broken fixtures

**Files:**
- Create: `supabase/tests/penjualan_access.test.sql`
- Modify: any pre-existing `*.test.sql` whose fixtures write these tables without a `user_role` claim (additive claim only).

**Interfaces:**
- Consumes: Task 1 migration.
- Produces: sales write guards proven; suite green.

- [ ] **Step 1: Write `penjualan_access.test.sql`**

`supabase/tests/penjualan_access.test.sql`. Seeds base data (style/colorway/sku/channel/order) as postgres (bypasses RLS), then switches JWT to act as sales / ops. INSERT/RPC denials raise (exception-catch). Before running, confirm columns for `channels`/`orders` against the live schema (`supabase/migrations/20260701000012_channel_order.sql`).

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('e1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','sell-owner@s.test','{"tenant_name":"Sell Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='e1111111-1111-1111-1111-111111111111');
  v_sales_uid uuid := 'e2222222-2222-2222-2222-222222222222';
  v_ops_uid uuid := 'e3333333-3333-3333-3333-333333333333';
  v_ch uuid; v_style uuid; v_cw uuid; v_sku uuid; v_seed_order uuid;
  v_order uuid; v_cnt int; v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_sales_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sell-s@s.test'),
    (v_ops_uid,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sell-o@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'sales' where id = v_sales_uid;
  update public.profiles set tenant_id = v_tenant, role = 'ops'   where id = v_ops_uid;

  -- base data as postgres (RLS bypassed)
  insert into public.channels (tenant_id, name) values (v_tenant, 'Seed Channel') returning id into v_ch;
  insert into public.styles (tenant_id, code, name) values (v_tenant,'SEL-01','Sell Style') returning id into v_style;
  insert into public.colorways (tenant_id, style_id, color_name, color_code) values (v_tenant, v_style, 'Black','BLK') returning id into v_cw;
  insert into public.skus (tenant_id, colorway_id, size, sku_code) values (v_tenant, v_cw, 'M','SEL-01-BLK-M') returning id into v_sku;
  -- a seed order (for the return test) + its stock so sale_out doesn't underflow
  insert into public.stock_ledger (tenant_id, sku_id, qty, reason) values (v_tenant, v_sku, 100, 'adjustment');
  insert into public.orders (tenant_id, code, channel_id, order_date) values (v_tenant,'ORD-SEED', v_ch, current_date) returning id into v_seed_order;

  -- === sales role: order + channel + return writes allowed ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  v_order := public.create_order(v_ch, null, 'Cust', null, jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 3, 'unit_price', 50000)));
  insert into public.channels (tenant_id, name) values (v_tenant, 'Sales Channel');  -- allowed
  perform public.create_return(v_order, null, 'defect', null, jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1)));

  reset role;

  -- === ops role: all three sales writes blocked, reads intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_order(v_ch, null, 'X', null, jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1, 'unit_price', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role created an order'; end if;

  v_failed := false;
  begin insert into public.channels (tenant_id, name) values (v_tenant, 'Ops Channel');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role created a channel'; end if;

  v_failed := false;
  begin perform public.create_return(v_order, null, 'x', null, jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role created a return'; end if;

  -- reads intact
  select count(*) into v_cnt from public.orders where id = v_order;
  if v_cnt <> 1 then raise exception 'FAIL: ops role cannot read orders'; end if;
  select count(*) into v_cnt from public.channels where id = v_ch;
  if v_cnt <> 1 then raise exception 'FAIL: ops role cannot read channels'; end if;

  reset role;
  raise notice 'penjualan_access OK: sales writes order/channel/return, ops blocked on all + reads intact';
end $$;

rollback;
```

Note: base data insert includes a `stock_ledger` adjustment of 100 so the sales-role `create_order` (which posts `sale_out` via `record_movement`) doesn't hit a negative-balance guard. If `record_movement` / `stock_ledger` rejects the direct seed insert (append-only grants), insert it as postgres BEFORE any `set_config('role', ...)` — which this test does (the seed block runs before the first role switch, i.e. as the migration/superuser role). If it still fails, seed the stock by calling `record_movement` as the sales role right after the first `set_config`, before `create_order`.

- [ ] **Step 2: Push**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
npx supabase db push --db-url "$SUPABASE_DB_URL"
```
Expected: `20260717000007_rbac_penjualan.sql` applied cleanly.

- [ ] **Step 3: Run new test + full regression**

```bash
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/penjualan_access.test.sql
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: both `RESULT: PASS`. Most pre-existing fixtures already carry `'user_role','owner'` (added in prior increments). If any test that writes `orders`/`order_lines`/`returns`/`return_lines`/`channels` under an authenticated JWT (not postgres) now fails closed, add `'user_role','owner'` to its claims block — PURELY ADDITIVE, no assertion changes. Iterate until green. Do NOT weaken assertions.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/
git commit -m "test: pgTAP penjualan role-access + user_role claim on affected fixtures"
```

---

### Task 3: `role.ts` sales helper

**Files:**
- Modify: `src/lib/auth/role.ts`

**Interfaces:**
- Produces: `canWriteSales(role)=owner|sales` — `(role: string | null) => boolean`.

- [ ] **Step 1: Append the helper**

Append to `src/lib/auth/role.ts` (keep everything else):

```ts
// Penjualan (Order/Channel/Retur) role gate.
export const canWriteSales = (role: string | null) => role === 'owner' || role === 'sales'
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/auth/role.ts
git commit -m "feat: sales role helper (canWriteSales)"
```

---

### Task 4: Sidebar — gate Penjualan group

**Files:**
- Modify: `src/components/SideNav.tsx`

**Interfaces:**
- Consumes: existing `roles?: string[]` filter + `role` prop.
- Produces: Penjualan (Order, Channel, Retur) hidden for production/inventory/viewer.

- [ ] **Step 1: Add `roles` to the Penjualan group items**

In `src/components/SideNav.tsx`, find:

```tsx
  { title: 'Penjualan', items: [{ label: 'Order', href: '/orders' }, { label: 'Channel', href: '/channels' }, { label: 'Retur', href: '/returns' }] },
```

Replace with:

```tsx
  { title: 'Penjualan', items: [
      { label: 'Order', href: '/orders', roles: ['owner', 'sales', 'ops', 'finance'] },
      { label: 'Channel', href: '/channels', roles: ['owner', 'sales', 'ops', 'finance'] },
      { label: 'Retur', href: '/returns', roles: ['owner', 'sales', 'ops', 'finance'] },
    ] },
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/SideNav.tsx
git commit -m "feat: gate Penjualan menu group to owner/sales/ops/finance"
```

---

### Task 5: UI write-control gating

**Files:**
- Modify: `src/app/(app)/orders/page.tsx`
- Modify: `src/app/(app)/channels/page.tsx`
- Modify: `src/app/(app)/returns/page.tsx`

**Interfaces:**
- Consumes: `getRole`, `canWriteSales` from `@/lib/auth/role` (Task 3).
- Produces: `+ Order Baru`, `ChannelForm`, `+ Retur Baru` render only for owner/sales; view roles see read-only.

- [ ] **Step 1: `orders/page.tsx` — gate `+ Order Baru`**

Change the import line:

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteSales } from '@/lib/auth/role'
import { rp } from '@/lib/ui'
```

After `const supabase = await createClient()` add:

```tsx
  const canWrite = canWriteSales(await getRole())
```

Replace the `+ Order Baru` link:

```tsx
        {canWrite && <Link href="/orders/new" className="vb-btn">+ Order Baru</Link>}
```

- [ ] **Step 2: `channels/page.tsx` — gate ChannelForm**

Change the import line:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteSales } from '@/lib/auth/role'
import ChannelForm from './ChannelForm'
```

After `const supabase = await createClient()` add:

```tsx
  const canWrite = canWriteSales(await getRole())
```

Replace the `<ChannelForm />` usage:

```tsx
        {canWrite ? <ChannelForm /> : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>Channel Baru</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya role Sales/Owner yang bisa menambah channel.</div>
          </div>
        )}
```

- [ ] **Step 3: `returns/page.tsx` — gate `+ Retur Baru`**

Change the import line:

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteSales } from '@/lib/auth/role'
```

After `const supabase = await createClient()` add:

```tsx
  const canWrite = canWriteSales(await getRole())
```

Replace the `+ Retur Baru` link:

```tsx
        {canWrite && <Link href="/returns/new" className="vb-btn">+ Retur Baru</Link>}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/orders" "src/app/(app)/channels" "src/app/(app)/returns"
git commit -m "feat: penjualan UI role-gating (order/channel/return create controls)"
```

---

### Task 6: E2E verify

**Files:** none.

- [ ] **Step 1: Full pgTAP regression**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: `RESULT: PASS`.

- [ ] **Step 2: Start dev server** via preview tool (`{name: "dev"}`, port 3100). Fresh browser tab per login; `document.querySelector('form').requestSubmit()` if a login click doesn't redirect.

- [ ] **Step 3: Log in as `sales.demo@vobia.test` / `password123`.** Verify:
  - Sidebar shows the Penjualan group (Order, Channel, Retur).
  - `/orders`: `+ Order Baru` visible; `/returns`: `+ Retur Baru` visible; `/channels`: Channel Baru form visible; can create a channel.

- [ ] **Step 4: Log in as `ops.demo@vobia.test` / `password123`.** Verify:
  - Sidebar shows the Penjualan group (ops is a view role).
  - `/orders`: NO `+ Order Baru` button; `/returns`: NO `+ Retur Baru` button; `/channels`: Channel Baru shows the "Hanya role Sales/Owner…" note.

- [ ] **Step 5: Log in as `prod.demo@vobia.test` / `password123`.** Verify:
  - Sidebar has NO Penjualan group (production ∉ view roles).
  - Direct URL `http://localhost:3100/orders`: loads read-only, no create button.

- [ ] **Step 6: Owner regression** — `superadmin@vobia.com`: Penjualan fully writable, no regression.

- [ ] **Step 7: Screenshots** of sales.demo vs ops.demo `/channels` (form vs note) as the artifact.
