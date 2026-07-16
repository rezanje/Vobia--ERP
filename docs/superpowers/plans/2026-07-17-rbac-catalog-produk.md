# RBAC Catalog-Produk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict catalog writes (Styles, Bahan/materials, BOM) to `owner`/`production`/`inventory`; hide the Produk menu group from `sales`/`viewer`; keep all catalog READS tenant-wide so cross-module reads (forecast/orders reading styles/skus) don't break.

**Architecture:** Same pattern as the P1–P3 RBAC (already merged): a role guard inside the one write RPC (`create_style_with_skus`), RESTRICTIVE per-command RLS write-policies on the directly-written tables (`skus`, `materials`, `bom_lines`), UI write-control gating via a `canWriteCatalog` helper, and sidebar visibility gating. Spec: `docs/superpowers/specs/2026-07-17-rbac-catalog-produk-design.md`.

**Tech Stack:** Next.js App Router + Supabase (Postgres, RLS, plpgsql), pgTAP via `scripts/pgtap.mjs`, `pg` client seeding script.

## Global Constraints

- Roles allowed to WRITE catalog: `owner`, `production`, `inventory`. Roles that may VIEW (see menu + read-only pages): those three plus `ops`, `finance`. `sales`/`viewer`: no menu, no write.
- JWT role claim key is `user_role` (`auth.jwt() ->> 'user_role'` in SQL; `getRole()` in TS). Fail-CLOSED: a missing `user_role` claim denies writes. In plpgsql use `coalesce(v_role not in (...), true)` (NULL → raise); in RLS use strict `(auth.jwt()->>'user_role') in (...)` (NULL → deny). Do NOT use a `coalesce(..., 'owner')` fallback anywhere — that was a fail-open bug last increment.
- READ is never restricted here: leave every existing `tenant_isolation` (SELECT) policy untouched; add only per-command WRITE policies (`for insert` / `for update` / `for delete`), never `for all` (which would also gate SELECT).
- RESTRICTIVE policy names must be UNIQUE per table per command (Postgres requires distinct policy names on a table) — use `catalog_write_insert` / `catalog_write_update` / `catalog_write_delete`.
- Migration file `supabase/migrations/20260717000004_rbac_catalog.sql`, pushed via `npx supabase db push --db-url "$SUPABASE_DB_URL"` (SUPABASE_DB_URL from `.env.local`, no Docker).
- Demo accounts: `prod.demo@vobia.test` (role `production`), `inv.demo@vobia.test` (role `inventory`), password `password123`, same tenant as `superadmin@vobia.com`.
- Dev server port 3100 via preview tool; UI Bahasa Indonesia, `vb-*` classes.
- Commit after each task.

---

### Task 1: Migration — role guard in `create_style_with_skus` + RLS write-gates

**Files:**
- Create: `supabase/migrations/20260717000004_rbac_catalog.sql`

**Interfaces:**
- Produces: `create_style_with_skus` rejects callers whose `user_role` isn't `owner`/`production`/`inventory`; `skus`/`materials`/`bom_lines` reject INSERT/UPDATE/DELETE from other roles at the RLS layer; all SELECTs unchanged.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260717000004_rbac_catalog.sql`:

```sql
-- RBAC catalog increment: gate catalog WRITES to owner/production/inventory.
-- READ stays tenant-wide (styles/skus/materials read cross-module) — only WRITE
-- is added, per-command, as RESTRICTIVE policies that AND on top of the existing
-- permissive tenant_isolation. Fail-closed: missing user_role claim denies.

-- (1) guard the sole styles/colorways/skus create path
create or replace function public.create_style_with_skus(
  p_code text,
  p_name text,
  p_collection text,
  p_colorways jsonb,
  p_sizes text[],
  p_overrides jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_style_id uuid;
  v_cw jsonb;
  v_color_code text;
  v_cw_id uuid;
  v_size text;
  v_code text;
begin
  if v_tenant is null then
    raise exception 'no tenant_id in JWT';
  end if;
  if coalesce(v_role not in ('owner','production','inventory'), true) then
    raise exception 'hanya role Produksi/Inventory/Owner yang boleh membuat style';
  end if;
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'code and name are required';
  end if;
  if p_colorways is null or jsonb_array_length(p_colorways) < 1 then
    raise exception 'at least one colorway required';
  end if;
  if array_length(p_sizes, 1) is null then
    raise exception 'at least one size required';
  end if;

  insert into public.styles (tenant_id, code, name, collection)
  values (v_tenant, p_code, p_name, nullif(trim(p_collection), ''))
  returning id into v_style_id;

  for v_cw in select value from jsonb_array_elements(p_colorways) loop
    v_color_code := v_cw ->> 'color_code';
    insert into public.colorways (tenant_id, style_id, color_name, color_code)
    values (v_tenant, v_style_id, v_cw ->> 'color_name', v_color_code)
    returning id into v_cw_id;

    foreach v_size in array p_sizes loop
      v_code := coalesce(
        p_overrides ->> (v_color_code || '-' || v_size),
        p_code || '-' || v_color_code || '-' || v_size
      );
      insert into public.skus (tenant_id, colorway_id, size, sku_code)
      values (v_tenant, v_cw_id, v_size, v_code);
    end loop;
  end loop;

  return v_style_id;
end;
$$;

-- (2) RESTRICTIVE write-gates on the directly-written catalog tables.
-- skus: insert (also used by create_style_with_skus — owner/prod/inv allowed there
-- too, so consistent), update (SkuToggle), delete (defensive).
create policy catalog_write_insert on public.skus as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_update on public.skus as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_delete on public.skus as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));

create policy catalog_write_insert on public.materials as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_update on public.materials as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_delete on public.materials as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));

create policy catalog_write_insert on public.bom_lines as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_update on public.bom_lines as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_delete on public.bom_lines as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
```

Note: no `grant execute` needed — `create or replace function` with unchanged argument types preserves the existing grant.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260717000004_rbac_catalog.sql
git commit -m "feat: RBAC catalog write-gates (create_style guard + skus/materials/bom RLS)"
```

Do NOT push yet — Task 2 pushes + tests.

---

### Task 2: Push + pgTAP + fix `create_style.test.sql` fixture

**Files:**
- Create: `supabase/tests/catalog_access.test.sql`
- Modify: `supabase/tests/create_style.test.sql` (add `user_role` to its JWT claims)

**Interfaces:**
- Consumes: Task 1 migration.
- Produces: catalog write guards proven; existing style test repaired.

- [ ] **Step 1: Fix the pre-existing `create_style.test.sql` fixture**

It sets JWT claims WITHOUT `user_role`, then calls `create_style_with_skus` — which the new guard will now reject (missing claim → deny). The test's tenant acts as its own owner, so add `'user_role','owner'`. Find the `set_config('request.jwt.claims', json_build_object(...))` call (around line 8) and add the claim. Current:

```sql
select set_config('request.jwt.claims',
  json_build_object('sub','d4444444-4444-4444-4444-444444444444','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='d4444444-4444-4444-4444-444444444444'))::text, true);
```

Change to (add the `'user_role','owner'` pair):

```sql
select set_config('request.jwt.claims',
  json_build_object('sub','d4444444-4444-4444-4444-444444444444','role','authenticated','user_role','owner',
    'tenant_id',(select tenant_id::text from public.profiles where id='d4444444-4444-4444-4444-444444444444'))::text, true);
```

If there is a second `set_config('request.jwt.claims', ...)` block anywhere in the file (re-auth), add the same `'user_role','owner'` to it too. (Grep the file for `request.jwt.claims` to be sure.)

- [ ] **Step 2: Write `catalog_access.test.sql`**

`supabase/tests/catalog_access.test.sql`. Seeds fixtures as postgres, then switches JWT to act as production vs sales, asserting allowed/blocked. Before running, verify the exact required columns for `styles`/`materials` inserts against the live schema (a prior test hit a `materials.category` NOT NULL check with no default — confirm and set a valid value like `'fabric'`).

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('c1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','cat-owner@s.test','{"tenant_name":"Cat Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='c1111111-1111-1111-1111-111111111111');
  v_prod_uid uuid := 'c2222222-2222-2222-2222-222222222222';
  v_sales_uid uuid := 'c3333333-3333-3333-3333-333333333333';
  v_style uuid;
  v_sku uuid;
  v_mat uuid;
  v_cnt int;
  v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_prod_uid,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cat-prod@s.test'),
    (v_sales_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cat-sales@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'production' where id = v_prod_uid;
  update public.profiles set tenant_id = v_tenant, role = 'sales'      where id = v_sales_uid;

  -- === production role: catalog writes allowed ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_prod_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','production')::text, true);
  perform set_config('role','authenticated', true);

  v_style := public.create_style_with_skus('CAT-01','Cat Style',null,
    jsonb_build_array(jsonb_build_object('color_name','Black','color_code','BLK')),
    array['M','L']);
  select id into v_sku from public.skus where tenant_id = v_tenant limit 1;
  update public.skus set active = false where id = v_sku;   -- SkuToggle path
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_tenant,'MAT-01','Kain Test','fabric','m') returning id into v_mat;
  insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit)
    values (v_tenant, v_style, v_mat, 1.5);

  reset role;

  -- === sales role: every catalog write blocked, but reads still work ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_style_with_skus('CAT-X','X',null,
      jsonb_build_array(jsonb_build_object('color_name','Red','color_code','RED')), array['M']);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role created a style'; end if;

  v_failed := false;
  begin update public.skus set active = true where id = v_sku;
  exception when others then v_failed := true; end;
  -- RLS update denial does not raise; it silently updates 0 rows. Verify no row changed:
  if (select active from public.skus where id = v_sku) is distinct from false then
    raise exception 'FAIL: sales role updated a sku';
  end if;

  v_failed := false;
  begin insert into public.materials (tenant_id, code, name, category, uom)
      values (v_tenant,'MAT-SALES','Nope','fabric','m');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role inserted a material'; end if;

  v_failed := false;
  begin insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit)
      values (v_tenant, v_style, v_mat, 2);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role inserted a bom line'; end if;

  -- reads NOT broken: sales can still SELECT styles + materials
  select count(*) into v_cnt from public.styles where id = v_style;
  if v_cnt <> 1 then raise exception 'FAIL: sales role cannot read styles (read over-restricted)'; end if;
  select count(*) into v_cnt from public.materials where id = v_mat;
  if v_cnt <> 1 then raise exception 'FAIL: sales role cannot read materials (read over-restricted)'; end if;

  reset role;
  raise notice 'catalog_access OK: production writes, sales blocked on style/sku/material/bom writes, sales reads intact';
end $$;

rollback;
```

Note on the sku-update assertion: an RLS write-policy denial on UPDATE does NOT raise — it matches zero rows and silently no-ops. So that case is verified by re-reading the row and asserting it stayed `false`, not by catching an exception. INSERT denials via RESTRICTIVE `with check` DO raise (`new row violates row-level security policy`), so those use the exception pattern.

- [ ] **Step 3: Push**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
npx supabase db push --db-url "$SUPABASE_DB_URL"
```
Expected: `20260717000004_rbac_catalog.sql` applied without error.

- [ ] **Step 4: Run the new test + regression**

```bash
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/catalog_access.test.sql
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: both `RESULT: PASS`. `create_style.test.sql` must pass because of its new `user_role` claim (Step 1), not a weakened guard. If push reports "no changes" but you edited an already-applied migration, this is a fresh migration (000004) so it should apply cleanly; if a re-run is ever needed, the policies use fixed names (`catalog_write_*`) and would need `drop policy if exists` first.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/catalog_access.test.sql supabase/tests/create_style.test.sql
git commit -m "test: pgTAP catalog role-access + fix create_style fixture user_role claim"
```

---

### Task 3: Seed `production` + `inventory` demo accounts

**Files:**
- Modify: `scripts/seed-users.mjs`

**Interfaces:**
- Consumes: existing owner account + the seed pattern already in the file.
- Produces: `prod.demo@vobia.test` (production) + `inv.demo@vobia.test` (inventory) in the same tenant.

- [ ] **Step 1: Extend the `DEMO_USERS` array**

Read `scripts/seed-users.mjs`. It has a `DEMO_USERS` array (currently the sales + ops entries). Add two entries so it reads:

```js
const DEMO_USERS = [
  { email: 'sales.demo@vobia.test', role: 'sales', full_name: 'Sales Demo' },
  { email: 'ops.demo@vobia.test', role: 'ops', full_name: 'Ops Demo' },
  { email: 'prod.demo@vobia.test', role: 'production', full_name: 'Produksi Demo' },
  { email: 'inv.demo@vobia.test', role: 'inventory', full_name: 'Inventory Demo' },
];
```

The rest of the script (auth.users insert with `''` token columns, profile repoint, orphan-tenant cleanup, idempotency) already handles any entry generically — no other change needed.

- [ ] **Step 2: Run it**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
node scripts/seed-users.mjs superadmin@vobia.com
```
Expected: `done: [...]` listing all four demo accounts, the two new ones with roles `production`/`inventory`, all sharing superadmin's tenant_id.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-users.mjs
git commit -m "feat: seed production + inventory demo accounts"
```

---

### Task 4: `role.ts` catalog helpers

**Files:**
- Modify: `src/lib/auth/role.ts`

**Interfaces:**
- Produces: `canWriteCatalog(role) = owner|production|inventory`, `canViewCatalog(role) = owner|production|inventory|ops|finance` — both `(role: string | null) => boolean`.

- [ ] **Step 1: Add the helpers**

Append to `src/lib/auth/role.ts` (after the existing P1–P3 helpers, keep everything else unchanged):

```ts
// Catalog (Styles/Bahan/BOM) role gates.
export const canWriteCatalog = (role: string | null) => role === 'owner' || role === 'production' || role === 'inventory'
export const canViewCatalog = (role: string | null) =>
  role === 'owner' || role === 'production' || role === 'inventory' || role === 'ops' || role === 'finance'
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/auth/role.ts
git commit -m "feat: catalog role helpers (canWriteCatalog/canViewCatalog)"
```

---

### Task 5: Sidebar — gate Produk group items

**Files:**
- Modify: `src/components/SideNav.tsx`

**Interfaces:**
- Consumes: the existing `roles?: string[]` per-item filtering + `role` prop (already added in the P1–P3 RBAC).
- Produces: Styles/Bahan/HPP hidden for `sales`/`viewer`; Stok stays unrestricted.

- [ ] **Step 1: Add `roles` to the three Produk items**

In `src/components/SideNav.tsx`, find the Produk group:

```tsx
  { title: 'Produk', items: [{ label: 'Styles', href: '/styles' }, { label: 'Stok', href: '/stock' }, { label: 'Bahan', href: '/materials' }, { label: 'HPP', href: '/costing' }] },
```

Replace with (add `roles` to Styles/Bahan/HPP; leave Stok untouched — it's the ledger, a later increment):

```tsx
  { title: 'Produk', items: [
      { label: 'Styles', href: '/styles', roles: ['owner', 'production', 'inventory', 'ops', 'finance'] },
      { label: 'Stok', href: '/stock' },
      { label: 'Bahan', href: '/materials', roles: ['owner', 'production', 'inventory', 'ops', 'finance'] },
      { label: 'HPP', href: '/costing', roles: ['owner', 'production', 'inventory', 'ops', 'finance'] },
    ] },
```

(The existing filter `!it.roles || it.roles.includes(role ?? '')` and empty-group hiding handle the rest. Note: for `sales`/`viewer` the group won't be empty — Stok has no `roles` so it stays visible — meaning the Produk header still shows with just "Stok" under it. That's correct: Stok isn't part of this increment.)

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/SideNav.tsx
git commit -m "feat: gate Produk catalog menu items to catalog+view roles"
```

---

### Task 6: UI write-control gating (Styles, Bahan, BOM, SKU toggle)

**Files:**
- Modify: `src/app/(app)/styles/page.tsx`
- Modify: `src/app/(app)/styles/[id]/page.tsx`
- Modify: `src/app/(app)/styles/[id]/SkuToggle.tsx`
- Modify: `src/app/(app)/styles/[id]/BomSection.tsx`
- Modify: `src/app/(app)/materials/page.tsx`

**Interfaces:**
- Consumes: `getRole`, `canWriteCatalog` from `@/lib/auth/role` (Task 4).
- Produces: write controls (`+ Style Baru`, SKU toggle, BOM add/remove, MaterialForm) render only for `canWriteCatalog` roles; view roles see read-only.

- [ ] **Step 1: `styles/page.tsx` — gate the `+ Style Baru` link**

Change the import line:

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteCatalog } from '@/lib/auth/role'
```

After `const supabase = await createClient()` add:

```tsx
  const canWrite = canWriteCatalog(await getRole())
```

Replace the `+ Style Baru` link:

```tsx
        {canWrite && <Link href="/styles/new" className="vb-btn">+ Style Baru</Link>}
```

- [ ] **Step 2: `styles/[id]/page.tsx` — fetch role, pass to SkuToggle + BomSection**

Change the import line:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteCatalog } from '@/lib/auth/role'
import SkuToggle from './SkuToggle'
import BomSection from './BomSection'
```

After `const { id } = await params` add:

```tsx
  const canWrite = canWriteCatalog(await getRole())
```

Change the `<SkuToggle ... />` usage to pass `canWrite`:

```tsx
              <SkuToggle id={k.id} active={k.active} canWrite={canWrite} />
```

Change the `<BomSection ... />` usage to pass `canWrite`:

```tsx
      <BomSection
        styleId={id}
        materials={allMaterials ?? []}
        rows={(bomRows ?? []).map((r) => ({ id: r.id, material_id: r.material_id, qty_per_unit: Number(r.qty_per_unit) }))}
        canWrite={canWrite}
      />
```

- [ ] **Step 3: `SkuToggle.tsx` — read-only when `!canWrite`**

Full new content:

```tsx
'use client'
import { useState } from 'react'
import { toggleSku } from '@/lib/products/actions'

export default function SkuToggle({ id, active, canWrite }: { id: string; active: boolean; canWrite: boolean }) {
  const [on, setOn] = useState(active)
  if (!canWrite) {
    return <span style={{ fontSize: 11.5, color: on ? '#93d6a1' : 'var(--vb-muted)' }}>{on ? 'Aktif' : 'Nonaktif'}</span>
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className={`vb-toggle ${on ? 'on' : 'off'}`} onClick={async () => {
        const next = !on
        setOn(next)
        await toggleSku(id, next)
      }}>
        <span className="vb-toggle-knob" />
      </button>
      <span style={{ fontSize: 11.5, color: on ? '#93d6a1' : 'var(--vb-muted)' }}>{on ? 'Aktif' : 'Nonaktif'}</span>
    </div>
  )
}
```

- [ ] **Step 4: `BomSection.tsx` — hide add-form + remove buttons when `!canWrite`**

Change the component signature:

```tsx
export default function BomSection({ styleId, materials, rows, canWrite }: { styleId: string; materials: MatOption[]; rows: BomRow[]; canWrite: boolean }) {
```

In the rows map, gate the remove `×` button (replace the existing remove button line):

```tsx
          {canWrite ? (
            <button type="button" className="vb-btn" style={{ padding: '2px 8px' }} onClick={() => onRemove(r.id)}>×</button>
          ) : <div />}
```

Gate the entire add-row block at the bottom (wrap the `<div style={{ display: 'grid', gridTemplateColumns: '1.6fr 120px auto', ...}}>...</div>` that contains the Bahan select + Qty + Tambah button):

```tsx
      {canWrite && (
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
      )}
```

- [ ] **Step 5: `materials/page.tsx` — render MaterialForm only for writers**

Change the import line:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteCatalog } from '@/lib/auth/role'
import MaterialForm from './MaterialForm'
```

After `const supabase = await createClient()` add:

```tsx
  const canWrite = canWriteCatalog(await getRole())
```

Replace the `<MaterialForm />` usage:

```tsx
        {canWrite ? <MaterialForm /> : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>Bahan Baru</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya role Produksi/Inventory/Owner yang bisa menambah bahan.</div>
          </div>
        )}
```

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/styles" "src/app/(app)/materials"
git commit -m "feat: catalog UI write-gating (styles/SKU/BOM/materials controls)"
```

---

### Task 7: E2E verify

**Files:** none (verification only).

- [ ] **Step 1: Full pgTAP regression**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: `RESULT: PASS`.

- [ ] **Step 2: Start dev server** via preview tool (`{name: "dev"}`, port 3100). Use a FRESH browser tab for each login (a long-lived tab can wedge Server-Action cookies mid-session — open a new tab and drive the login form, or submit via `form.requestSubmit()` in the page, if a click doesn't redirect).

- [ ] **Step 3: Log in as `prod.demo@vobia.test` / `password123`.** Verify:
  - Sidebar Produk group shows Styles, Stok, Bahan, HPP.
  - `/styles`: `+ Style Baru` button visible; can open `/styles/new` and create a style successfully.
  - `/styles/[id]`: SKU toggle is an interactive switch; BOM section shows the add-row form + `×` remove buttons.
  - `/materials`: MaterialForm (Bahan Baru) visible; can add a material.

- [ ] **Step 4: Log in as `sales.demo@vobia.test` / `password123`.** Verify:
  - Sidebar Produk group shows ONLY Stok (Styles/Bahan/HPP hidden).
  - Direct URL `http://localhost:3100/styles`: page still loads (read allowed) but NO `+ Style Baru` button.
  - Direct URL `http://localhost:3100/materials`: loads, table visible, but the right panel shows the "Hanya role Produksi/Inventory/Owner…" note instead of the form.
  - `/styles/[id]`: SKU status shows as plain text (no toggle switch); BOM shows rows read-only (no add form, no `×`).

- [ ] **Step 5: Regression check on an existing role** — log in as `ops.demo@vobia.test`: Produk group shows Styles/Bahan/HPP (ops is a view role) but read-only (no create/add controls); confirms view-vs-write split. And `superadmin@vobia.com` (owner): everything still fully writable, no regression.

- [ ] **Step 6: Screenshots** of the prod.demo vs sales.demo Styles page (write vs read-only) as the artifact.
