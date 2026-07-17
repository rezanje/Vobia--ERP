# RBAC Pembelian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is intended to be executed in a fresh chat session.** It is self-contained. Before starting: `git checkout main && git pull`-equivalent (ensure you're on `main` with the prior RBAC increments merged — the latest should be the Lokasi increment, migration `20260717000008`), then create a branch `feat/rbac-pembelian`.

**Goal:** Restrict purchase-order create + goods-receive to `owner`/`ops`/`inventory`; `finance` views; hide the Pembelian menu item from roles without access; keep reads tenant-wide.

**Architecture:** Same pattern as the merged Catalog/Produksi/Penjualan/Lokasi RBAC increments — role guards inside the two purchasing RPCs (`create_purchase_order` invoker, `receive_purchase` **security definer**), RESTRICTIVE per-command write-RLS on `purchase_orders`/`purchase_lines`, UI gating via `canWritePurchasing`, sidebar visibility gating. Spec: `docs/superpowers/specs/2026-07-17-rbac-pembelian-design.md`.

**Tech Stack:** Next.js App Router + Supabase (Postgres, RLS, plpgsql), pgTAP via `scripts/pgtap.mjs`, `pg` client seeding.

## Global Constraints

- Write role set (all three surfaces): `owner,ops,inventory`. View-only (menu + read-only) adds `finance`.
- JWT role claim key is `user_role`. Fail-CLOSED: plpgsql `coalesce(v_role not in (...), true)` (NULL → raise); RLS strict `(auth.jwt()->>'user_role') in (...)` (NULL → deny). NEVER a `coalesce(..., 'owner')` fail-open fallback.
- READ never restricted: leave every `tenant_isolation` (SELECT) policy untouched; add only per-command WRITE policies (`for insert`/`for update`/`for delete`), NEVER `for all`. Restrictive policy names unique per table per command: `buy_write_insert`/`buy_write_update`/`buy_write_delete`.
- **`receive_purchase` MUST stay `security definer`** — do NOT change its security mode. Because RLS does not apply to security-definer functions, its in-body role guard is the ONLY thing gating receive-by-role (same as `lock_projection` in the P1–P3 increment).
- **`purchase_orders`/`purchase_lines` are shared with `issue_ppo_pos`** (manufacturing CMT child-PO creation, callers owner/ops). The write-RLS role set `owner/ops/inventory` is a superset of `{owner,ops}`, so that flow keeps working — but you MUST regression-check `planning.test.sql` after the migration.
- Migration `supabase/migrations/20260717000009_rbac_pembelian.sql`, pushed via `npx supabase db push --db-url "$SUPABASE_DB_URL"` (SUPABASE_DB_URL from `.env.local`, no Docker).
- Dev server port 3100 via preview tool; UI Bahasa Indonesia, `vb-*`; fresh browser tab per login, `document.querySelector('form').requestSubmit()` if a login click doesn't redirect (the preview tab can render 0×0).
- Scope excludes `/material-stock` (Stok Bahan) — its adjustment is deferred to the Stok increment. Do NOT gate the "Stok Bahan" sidebar item or `record_material_movement`.
- Commit after each task.

---

### Task 1: Migration — fn guards + RLS write-gates

**Files:**
- Create: `supabase/migrations/20260717000009_rbac_pembelian.sql`

**Interfaces:**
- Produces: `create_purchase_order` + `receive_purchase` reject non-`owner`/`ops`/`inventory` callers; `purchase_orders`/`purchase_lines` reject writes from other roles at RLS; SELECTs unchanged.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260717000009_rbac_pembelian.sql`:

```sql
-- RBAC Pembelian increment: gate PO create + receive to owner/ops/inventory.
-- READ stays tenant-wide. receive_purchase stays SECURITY DEFINER — its in-body
-- guard is the sole role gate for receive (RLS never applies to definer fns).
-- purchase_orders/purchase_lines are shared with issue_ppo_pos (owner/ops) — the
-- owner/ops/inventory RLS set is a superset, so that flow still works.

-- (1) create_purchase_order (invoker) — guard + unchanged body
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
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'PB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_po uuid;
  v_line jsonb;
  v_mat uuid;
  v_mat_tenant uuid;
  v_loc uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','ops','inventory'), true) then
    raise exception 'hanya role Ops/Inventory/Owner yang boleh membuat PO pembelian';
  end if;
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

-- (2) receive_purchase (DEFINER — keep it) — guard + unchanged body
create or replace function public.receive_purchase(
  p_po_id uuid,
  p_receipts jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_status text;
  v_loc uuid;
  v_rec jsonb;
  v_line public.purchase_lines;
  v_qty numeric;
  v_all_full boolean;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','ops','inventory'), true) then
    raise exception 'hanya role Ops/Inventory/Owner yang boleh menerima barang';
  end if;
  select status, location_id into v_status, v_loc from public.purchase_orders
    where id = p_po_id and tenant_id = v_tenant;
  if v_status is null then raise exception 'purchase order not found'; end if;
  if v_status = 'canceled' then raise exception 'cannot receive a canceled PO'; end if;
  if p_receipts is null or jsonb_array_length(p_receipts) < 1 then raise exception 'no receipts'; end if;

  for v_rec in select value from jsonb_array_elements(p_receipts) loop
    v_qty := (v_rec ->> 'qty')::numeric;
    if v_qty <= 0 then raise exception 'receipt qty must be > 0'; end if;
    select * into v_line from public.purchase_lines
      where id = (v_rec ->> 'line_id')::uuid and po_id = p_po_id and tenant_id = v_tenant for update;
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

-- (3) RESTRICTIVE write-gates -> owner/ops/inventory
create policy buy_write_insert on public.purchase_orders as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops','inventory'));
create policy buy_write_update on public.purchase_orders as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops','inventory'));
create policy buy_write_delete on public.purchase_orders as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops','inventory'));

create policy buy_write_insert on public.purchase_lines as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops','inventory'));
create policy buy_write_update on public.purchase_lines as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops','inventory'));
create policy buy_write_delete on public.purchase_lines as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops','inventory'));
```

Note: no `grant execute` — `create or replace function` with unchanged argument types preserves the existing grant.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260717000009_rbac_pembelian.sql
git commit -m "feat: RBAC pembelian write-gates (PO create + receive guards + RLS)"
```

Do NOT push yet — Task 2 pushes + tests.

---

### Task 2: Push + pgTAP + fix broken fixtures

**Files:**
- Create: `supabase/tests/pembelian_access.test.sql`
- Modify: any pre-existing `*.test.sql` whose fixtures write `purchase_orders`/`purchase_lines` under an authenticated JWT without a `user_role` claim (additive claim only).

**Interfaces:**
- Consumes: Task 1 migration.
- Produces: purchasing write guards proven; suite green (incl. the issue_ppo_pos cross-flow in `planning.test.sql`).

- [ ] **Step 1: Write `pembelian_access.test.sql`**

`supabase/tests/pembelian_access.test.sql`. Seeds base data (vendor/material/location/PO) as postgres (bypasses RLS), then switches JWT to act as ops / finance. The receive-block for finance MUST be tested (it exercises the security-definer in-body guard — the whole point). INSERT/RPC denials raise (exception-catch). Before running, confirm columns for `vendors`/`materials`/`purchase_orders` against the live schema (`20260701000009_production_vendor.sql`, `20260709000002_materials.sql`, `20260710000003_purchasing.sql`; note `materials` has a NOT NULL `category`).

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('a8811111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','buy-owner@s.test','{"tenant_name":"Buy Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='a8811111-1111-1111-1111-111111111111');
  v_ops_uid uuid := 'a8822222-2222-2222-2222-222222222222';
  v_fin_uid uuid := 'a8833333-3333-3333-3333-333333333333';
  v_vendor uuid; v_mat uuid; v_loc uuid;
  v_po uuid; v_line uuid; v_cnt int; v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_ops_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','buy-ops@s.test'),
    (v_fin_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','buy-fin@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'ops'     where id = v_ops_uid;
  update public.profiles set tenant_id = v_tenant, role = 'finance' where id = v_fin_uid;

  -- base data as postgres (RLS bypassed). The new-user trigger already seeded a default location.
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
  insert into public.vendors (tenant_id, name) values (v_tenant,'Buy Vendor') returning id into v_vendor;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_tenant,'BUY-MAT','Kain Buy','fabric','m') returning id into v_mat;

  -- === ops role: create PO + receive allowed ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);

  v_po := public.create_purchase_order(v_vendor, v_loc, null, 'test', jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty_ordered', 10, 'unit_price', 5000)));
  select id into v_line from public.purchase_lines where po_id = v_po limit 1;
  perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 4)));

  reset role;

  -- === finance role: create + receive blocked, reads intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_fin_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','finance')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_purchase_order(v_vendor, v_loc, null, 'x', jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty_ordered', 1, 'unit_price', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: finance role created a purchase order'; end if;

  -- receive block exercises the SECURITY DEFINER in-body guard specifically
  v_failed := false;
  begin perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: finance role received goods (definer guard bypassed)'; end if;

  -- reads intact
  select count(*) into v_cnt from public.purchase_orders where id = v_po;
  if v_cnt <> 1 then raise exception 'FAIL: finance role cannot read purchase_orders'; end if;

  reset role;
  raise notice 'pembelian_access OK: ops creates+receives, finance blocked on create+receive (definer guard) + reads intact';
end $$;

rollback;
```

- [ ] **Step 2: Push**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
npx supabase db push --db-url "$SUPABASE_DB_URL"
```
Expected: `20260717000009_rbac_pembelian.sql` applied cleanly.

- [ ] **Step 3: Run new test + FULL regression (watch the cross-flow)**

```bash
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/pembelian_access.test.sql
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: both `RESULT: PASS`. **Pay special attention to `planning.test.sql`** — it exercises `issue_ppo_pos` writing child POs into `purchase_orders`/`purchase_lines`; the new write-RLS must not break it (its test tenant acts as `owner`, which is in the allowed set, so it should pass; if it fails closed, the fixture is missing a `user_role` claim — add `'user_role','owner'` additively, do NOT loosen the RLS). Also `purchasing.test.sql` likely writes these tables — add `'user_role','owner'` to its claims block if it fails closed. Purely additive; no assertion changes. Iterate until green.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/
git commit -m "test: pgTAP pembelian role-access + user_role claim on affected fixtures"
```

---

### Task 3: Seed a `finance` demo account

**Files:**
- Modify: `scripts/seed-users.mjs`

**Interfaces:**
- Consumes: existing owner account + the seed pattern.
- Produces: `finance.demo@vobia.test` (role `finance`) in the same tenant — needed to browser-verify the finance view-only case (and useful for the future Keuangan/HR increments).

- [ ] **Step 1: Add the finance entry to `DEMO_USERS`**

In `scripts/seed-users.mjs`, the `DEMO_USERS` array currently has sales/ops/production/inventory. Add a fifth entry so it reads:

```js
const DEMO_USERS = [
  { email: 'sales.demo@vobia.test', role: 'sales', full_name: 'Sales Demo' },
  { email: 'ops.demo@vobia.test', role: 'ops', full_name: 'Ops Demo' },
  { email: 'prod.demo@vobia.test', role: 'production', full_name: 'Produksi Demo' },
  { email: 'inv.demo@vobia.test', role: 'inventory', full_name: 'Inventory Demo' },
  { email: 'finance.demo@vobia.test', role: 'finance', full_name: 'Finance Demo' },
];
```

The rest of the script handles any entry generically — no other change.

- [ ] **Step 2: Run it**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
node scripts/seed-users.mjs superadmin@vobia.com
```
Expected: `done: [...]` now listing 5 demo accounts, the new `finance.demo@vobia.test` with role `finance`, same tenant as superadmin.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-users.mjs
git commit -m "feat: seed finance demo account"
```

---

### Task 4: `role.ts` helper + sidebar gate

**Files:**
- Modify: `src/lib/auth/role.ts`
- Modify: `src/components/SideNav.tsx`

**Interfaces:**
- Consumes: existing `roles?: string[]` sidebar filter + `role` prop.
- Produces: `canWritePurchasing(role)=owner|ops|inventory`; the Pembelian menu item hidden for sales/production/viewer.

- [ ] **Step 1: Append the helper to `role.ts`**

Append to `src/lib/auth/role.ts` (keep everything else):

```ts
// Pembelian role gate.
export const canWritePurchasing = (role: string | null) => role === 'owner' || role === 'ops' || role === 'inventory'
```

- [ ] **Step 2: Gate the "Pembelian" sidebar item (leave "Stok Bahan" alone)**

In `src/components/SideNav.tsx`, find:

```tsx
  { title: 'Pembelian', items: [{ label: 'Pembelian', href: '/purchasing' }, { label: 'Stok Bahan', href: '/material-stock' }] },
```

Replace with (gate only the Pembelian item; Stok Bahan stays unrestricted — deferred to the Stok increment):

```tsx
  { title: 'Pembelian', items: [
      { label: 'Pembelian', href: '/purchasing', roles: ['owner', 'ops', 'inventory', 'finance'] },
      { label: 'Stok Bahan', href: '/material-stock' },
    ] },
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/auth/role.ts src/components/SideNav.tsx
git commit -m "feat: purchasing role helper + sidebar gate for Pembelian item"
```

---

### Task 5: UI write-control gating

**Files:**
- Modify: `src/app/(app)/purchasing/page.tsx`
- Modify: `src/app/(app)/purchasing/[id]/page.tsx`

**Interfaces:**
- Consumes: `getRole`, `canWritePurchasing` from `@/lib/auth/role` (Task 4).
- Produces: the create-PO form (`PurchaseForm`) and the receive form (`ReceiveForm`) render write controls only for owner/ops/inventory; view roles (finance) see read-only.

- [ ] **Step 1: `purchasing/page.tsx` — gate PurchaseForm**

The current file imports `PurchaseForm` and renders `<PurchaseForm vendors={vendors ?? []} materials={materials ?? []} locations={locations ?? []} />` in a 2-column grid. Change the import line at the top:

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRole, canWritePurchasing } from '@/lib/auth/role'
import PurchaseForm from './PurchaseForm'
```

After `const supabase = await createClient()` add:

```tsx
  const canWrite = canWritePurchasing(await getRole())
```

Replace the `<PurchaseForm ... />` usage with:

```tsx
        {canWrite ? (
          <PurchaseForm vendors={vendors ?? []} materials={materials ?? []} locations={locations ?? []} />
        ) : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>PO Bahan Baru</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya role Ops/Inventory/Owner yang bisa membuat PO pembelian.</div>
          </div>
        )}
```

(If the exact `import Link` / other imports differ, keep them — only ADD the `getRole, canWritePurchasing` import and the `canWrite` line, and wrap the existing `<PurchaseForm .../>`.)

- [ ] **Step 2: `purchasing/[id]/page.tsx` — gate ReceiveForm via its `disabled` prop**

This page already fetches `const role = await getRole()` (for `canApprove`). Change the import line to also bring `canWritePurchasing`:

```tsx
import { getRole, canApprove, canWritePurchasing } from '@/lib/auth/role'
```

Right after the existing `const role = await getRole()` line, add:

```tsx
  const canWrite = canWritePurchasing(role)
```

The page currently renders:

```tsx
      <ReceiveForm poId={po.id} lines={formLines} disabled={!approved || po.status === 'canceled' || po.status === 'received'} />
```

`ReceiveForm`'s `disabled` prop already disables the qty inputs AND hides the "Terima Bahan" button, so extending it gates the whole receive action for view roles. Change it to:

```tsx
      <ReceiveForm poId={po.id} lines={formLines} disabled={!canWrite || !approved || po.status === 'canceled' || po.status === 'received'} />
```

(The `DocActions` approve control is unchanged — it keeps its existing `canApprove(role)` gate, which is owner/ops, out of scope for this write increment.)

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/purchasing"
git commit -m "feat: purchasing UI role-gating (create PO form + receive form)"
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

- [ ] **Step 3: Log in as `ops.demo@vobia.test` / `password123`.** Verify:
  - Sidebar Pembelian group shows Pembelian + Stok Bahan.
  - `/purchasing`: the "PO Bahan Baru" form is visible; can create a PO.
  - `/purchasing/[id]` (an approved PO): the Penerimaan (receive) form has editable qty inputs + "Terima Bahan" button; can receive.

- [ ] **Step 4: Log in as `finance.demo@vobia.test` / `password123`.** Verify:
  - Sidebar Pembelian group shows Pembelian (finance is a view role) + Stok Bahan.
  - `/purchasing`: the right panel shows the "Hanya role Ops/Inventory/Owner…" note instead of the create form.
  - `/purchasing/[id]`: the Penerimaan table renders read-only (qty inputs disabled, no "Terima Bahan" button).

- [ ] **Step 5: Log in as `sales.demo@vobia.test` / `password123`.** Verify:
  - Sidebar has NO Pembelian item under the Pembelian group header — actually the header still shows because "Stok Bahan" is ungated; confirm ONLY "Stok Bahan" appears under Pembelian, and "Pembelian" is hidden.
  - Direct URL `http://localhost:3100/purchasing`: loads read-only, create form replaced by the note.

- [ ] **Step 6: Manufacturing cross-flow regression (critical)** — log in as `ops.demo` (or `superadmin`), open an existing CMT PPO detail (`/ppo/[id]` with scheme cmt in draft) and issue its child POs, OR just confirm an already-issued PPO's child POs still render in `/purchasing`. This confirms the `purchase_orders` write-RLS didn't break `issue_ppo_pos`. (The pgTAP `planning.test.sql` already covers this at the DB level; this is the UI-level sanity check.)

- [ ] **Step 7: Owner regression** — `superadmin@vobia.com`: Pembelian fully writable (create + receive), no regression.

- [ ] **Step 8: Screenshots** of ops.demo vs finance.demo `/purchasing` (create form vs note) as the artifact.
