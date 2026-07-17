# RBAC Produksi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict production writes (create order, stage transition, QC receiving) to `owner`/`production`; open Vendor create to `owner`/`production`/`ops`; restrict production cost entries (HPP) to `owner`/`production`/`inventory`; hide the Produksi menu group from roles without access; keep all reads tenant-wide.

**Architecture:** Same pattern as the merged Catalog RBAC increment — role guards inside the two write RPCs (`create_production_order`, `transition_production_stage`), RESTRICTIVE per-command write-RLS on the directly/fn-written tables (`production_orders`, `prod_lines`, `vendors`, `cost_entries`), UI write-control gating via `role.ts` helpers, sidebar visibility gating. Spec: `docs/superpowers/specs/2026-07-17-rbac-produksi-design.md`.

**Tech Stack:** Next.js App Router + Supabase (Postgres, RLS, plpgsql), pgTAP via `scripts/pgtap.mjs`.

## Global Constraints

- Write role sets: production orders/transition/QC = `owner,production`; Vendor = `owner,production,ops`; cost entries = `owner,production,inventory`. View-only for Produksi orders adds `ops`.
- JWT role claim key is `user_role` (`auth.jwt() ->> 'user_role'` in SQL; `getRole()` in TS). Fail-CLOSED: missing claim denies. plpgsql: `coalesce(v_role not in (...), true)` (NULL → raise). RLS: strict `(auth.jwt()->>'user_role') in (...)` (NULL → deny). NEVER a `coalesce(..., 'owner')` fail-open fallback.
- READ never restricted: leave every existing `tenant_isolation` (SELECT) policy untouched; add only per-command WRITE policies (`for insert`/`for update`/`for delete`), NEVER `for all` (which gates SELECT). Restrictive policy names unique per table per command: `prod_write_insert`/`prod_write_update`/`prod_write_delete`.
- Migration `supabase/migrations/20260717000006_rbac_production.sql`, pushed via `npx supabase db push --db-url "$SUPABASE_DB_URL"` (SUPABASE_DB_URL from `.env.local`, no Docker).
- No new demo accounts (production/inventory/ops/sales already seeded).
- Dev server port 3100 via preview tool; UI Bahasa Indonesia, `vb-*` classes; use a fresh browser tab per login and submit the login form via `document.querySelector('form').requestSubmit()` if a click doesn't redirect (the preview tab can render 0×0).
- Deferred (NOT this increment): `IssueSection` material-issue on the production detail page (→ `material_ledger`) belongs to the later Stok increment; leave it ungated. `DocActions` approval already uses `canApprove` — unchanged.
- Commit after each task.

---

### Task 1: Migration — fn guards + RLS write-gates

**Files:**
- Create: `supabase/migrations/20260717000006_rbac_production.sql`

**Interfaces:**
- Produces: `create_production_order` + `transition_production_stage` reject non-`owner`/`production` callers; `production_orders`/`prod_lines`/`vendors`/`cost_entries` reject writes from disallowed roles at RLS; all SELECTs unchanged.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260717000006_rbac_production.sql`:

```sql
-- RBAC Produksi increment: gate production writes. READ stays tenant-wide
-- (vendors read by procurement; prod_lines/cost_entries feed the sku_hpp view).
-- Fail-closed: missing user_role claim denies.

-- (1) guard the two production RPCs (create_or_replace preserves existing grants)
create or replace function public.create_production_order(
  p_style_id uuid,
  p_vendor_id uuid,
  p_deadline date,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'PO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_po uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','production'), true) then
    raise exception 'hanya role Produksi/Owner yang boleh membuat order produksi';
  end if;
  if not exists (select 1 from public.styles where id = p_style_id and tenant_id = v_tenant) then
    raise exception 'style not in tenant';
  end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id and tenant_id = v_tenant) then
    raise exception 'vendor not in tenant';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then
    raise exception 'at least one line required';
  end if;

  insert into public.production_orders (tenant_id, code, style_id, vendor_id, deadline, notes)
  values (v_tenant, v_code, p_style_id, p_vendor_id, p_deadline, nullif(trim(p_notes), ''))
  returning id into v_po;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_sku := (v_line ->> 'sku_id')::uuid;
    select tenant_id into v_sku_tenant from public.skus where id = v_sku;
    if v_sku_tenant is null or v_sku_tenant <> v_tenant then raise exception 'sku not in tenant'; end if;
    if (v_line ->> 'qty_ordered')::int <= 0 then raise exception 'qty_ordered must be > 0'; end if;
    insert into public.prod_lines (tenant_id, po_id, sku_id, qty_ordered)
    values (v_tenant, v_po, v_sku, (v_line ->> 'qty_ordered')::int);
  end loop;

  return v_po;
end; $$;

create or replace function public.transition_production_stage(
  p_po_id uuid,
  p_next_stage text
) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_current text;
  v_ok boolean;
  v_line record;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','production'), true) then
    raise exception 'hanya role Produksi/Owner yang boleh mengubah stage produksi';
  end if;
  select stage into v_current from public.production_orders where id = p_po_id;
  if v_current is null then raise exception 'production order not found'; end if;

  v_ok := case
    when v_current = 'trial' and p_next_stage in ('mass_production','canceled') then true
    when v_current = 'mass_production' and p_next_stage in ('qc','canceled') then true
    when v_current = 'qc' and p_next_stage in ('completed','mass_production','canceled') then true
    else false
  end;
  if not v_ok then raise exception 'illegal transition % -> %', v_current, p_next_stage; end if;

  if p_next_stage = 'completed' then
    for v_line in
      select id, sku_id, qty_received from public.prod_lines
      where po_id = p_po_id and qty_received > 0
    loop
      perform public.record_movement(v_line.sku_id, v_line.qty_received, 'production_in', null, 'production_line', v_line.id);
    end loop;
  end if;

  update public.production_orders set stage = p_next_stage where id = p_po_id;
end; $$;

-- (2) RESTRICTIVE write-gates. production_orders/prod_lines -> owner/production
create policy prod_write_insert on public.production_orders as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production'));
create policy prod_write_update on public.production_orders as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production'));
create policy prod_write_delete on public.production_orders as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production'));

create policy prod_write_insert on public.prod_lines as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production'));
create policy prod_write_update on public.prod_lines as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production'));
create policy prod_write_delete on public.prod_lines as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production'));

-- vendors -> owner/production/ops (master data used by procurement too)
create policy prod_write_insert on public.vendors as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','ops'));
create policy prod_write_update on public.vendors as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','ops'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','ops'));
create policy prod_write_delete on public.vendors as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','ops'));

-- cost_entries -> owner/production/inventory (HPP)
create policy prod_write_insert on public.cost_entries as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy prod_write_update on public.cost_entries as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy prod_write_delete on public.cost_entries as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260717000006_rbac_production.sql
git commit -m "feat: RBAC production write-gates (fn guards + production_orders/prod_lines/vendors/cost_entries RLS)"
```

Do NOT push yet — Task 2 pushes + tests.

---

### Task 2: Push + pgTAP + fix broken fixtures

**Files:**
- Create: `supabase/tests/production_access.test.sql`
- Modify: any pre-existing `*.test.sql` whose fixtures write these tables without a `user_role` claim (additive claim only).

**Interfaces:**
- Consumes: Task 1 migration.
- Produces: production write guards proven; suite green.

- [ ] **Step 1: Write `production_access.test.sql`**

`supabase/tests/production_access.test.sql`. Seeds base data as postgres (bypasses RLS), then switches JWT to act as production / ops / sales. Note the RLS-UPDATE-denial-is-silent rule: a blocked UPDATE no-ops (0 rows) rather than raising — verify by re-read. INSERT / RPC denials raise, so use exception-catch there. Before running, confirm column names for `styles`/`colorways`/`skus`/`vendors` against the live schema (`supabase/migrations/20260701000005_product_spine.sql`, `20260701000009_production_vendor.sql`).

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('d1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','prod-owner@s.test','{"tenant_name":"Prod Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='d1111111-1111-1111-1111-111111111111');
  v_prod_uid uuid := 'd2222222-2222-2222-2222-222222222222';
  v_ops_uid uuid := 'd3333333-3333-3333-3333-333333333333';
  v_sales_uid uuid := 'd4444444-4444-4444-4444-444444444444';
  v_style uuid; v_cw uuid; v_sku uuid; v_vendor uuid;
  v_po uuid; v_line uuid;
  v_cnt int; v_failed boolean; v_recv int;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_prod_uid,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','prod-p@s.test'),
    (v_ops_uid,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','prod-o@s.test'),
    (v_sales_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','prod-s@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'production' where id = v_prod_uid;
  update public.profiles set tenant_id = v_tenant, role = 'ops'        where id = v_ops_uid;
  update public.profiles set tenant_id = v_tenant, role = 'sales'      where id = v_sales_uid;

  -- base data as postgres (RLS bypassed here)
  insert into public.styles (tenant_id, code, name) values (v_tenant,'PRD-01','Prod Style') returning id into v_style;
  insert into public.colorways (tenant_id, style_id, color_name, color_code) values (v_tenant, v_style, 'Black','BLK') returning id into v_cw;
  insert into public.skus (tenant_id, colorway_id, size, sku_code) values (v_tenant, v_cw, 'M','PRD-01-BLK-M') returning id into v_sku;
  insert into public.vendors (tenant_id, name) values (v_tenant,'Seed Vendor') returning id into v_vendor;

  -- === production role: full production write chain ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_prod_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','production')::text, true);
  perform set_config('role','authenticated', true);

  v_po := public.create_production_order(v_style, v_vendor, null, 'test', jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 10)));
  select id into v_line from public.prod_lines where po_id = v_po limit 1;
  update public.prod_lines set qty_received = 5, reject_count = 1 where id = v_line;  -- QC path
  perform public.transition_production_stage(v_po, 'mass_production');
  insert into public.cost_entries (tenant_id, po_id, cost_type, amount) values (v_tenant, v_po, 'cmt', 500000);

  reset role;

  -- === ops role: vendor allowed, production writes blocked ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);

  insert into public.vendors (tenant_id, name) values (v_tenant, 'Ops Vendor');  -- allowed

  v_failed := false;
  begin perform public.create_production_order(v_style, v_vendor, null, 'nope', jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role created a production order'; end if;

  v_failed := false;
  begin perform public.transition_production_stage(v_po, 'qc');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role transitioned a production stage'; end if;

  -- prod_lines UPDATE denial is silent (0 rows), verify by re-read (production set it to 5)
  update public.prod_lines set qty_received = 9 where id = v_line;
  select qty_received into v_recv from public.prod_lines where id = v_line;
  if v_recv <> 5 then raise exception 'FAIL: ops role updated a prod_line (got %)', v_recv; end if;

  reset role;

  -- === sales role: all production writes + vendor blocked, reads intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_production_order(v_style, v_vendor, null, 'nope', jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role created a production order'; end if;

  v_failed := false;
  begin insert into public.vendors (tenant_id, name) values (v_tenant, 'Sales Vendor');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role created a vendor'; end if;

  v_failed := false;
  begin insert into public.cost_entries (tenant_id, po_id, cost_type, amount) values (v_tenant, v_po, 'cmt', 1);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role inserted a cost entry'; end if;

  -- reads intact
  select count(*) into v_cnt from public.production_orders where id = v_po;
  if v_cnt <> 1 then raise exception 'FAIL: sales role cannot read production_orders'; end if;
  select count(*) into v_cnt from public.vendors where id = v_vendor;
  if v_cnt <> 1 then raise exception 'FAIL: sales role cannot read vendors'; end if;

  reset role;
  raise notice 'production_access OK: production writes, ops vendor-only, sales blocked on all + reads intact';
end $$;

rollback;
```

- [ ] **Step 2: Push**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
npx supabase db push --db-url "$SUPABASE_DB_URL"
```
Expected: `20260717000006_rbac_production.sql` applied cleanly.

- [ ] **Step 3: Run new test + full regression**

```bash
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/production_access.test.sql
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: both `RESULT: PASS`. The new write-RLS will fail-close any pre-existing test whose JWT fixture writes `production_orders`/`prod_lines`/`vendors`/`cost_entries` without a `user_role` claim (likely `production.test.sql`, `costing.test.sql`, `bom_issue.test.sql`, and any purchasing/order test that seeds a vendor under an authenticated JWT). For each failing test, add `'user_role','owner'` to its `json_build_object(...)` claims block — PURELY ADDITIVE, no assertion changes. (Tests that seed vendors/production over a direct postgres connection bypass RLS and need no change.) Iterate until green. Do NOT weaken assertions.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/
git commit -m "test: pgTAP production role-access + user_role claim on affected fixtures"
```

---

### Task 3: `role.ts` production helpers

**Files:**
- Modify: `src/lib/auth/role.ts`

**Interfaces:**
- Produces: `canWriteProduction(role)=owner|production`; `canWriteVendor(role)=owner|production|ops`; `canWriteCost(role)=owner|production|inventory` — all `(role: string | null) => boolean`.

- [ ] **Step 1: Append the helpers**

Append to `src/lib/auth/role.ts` (keep everything else, including the existing `canWriteCatalog`):

```ts
// Produksi role gates.
export const canWriteProduction = (role: string | null) => role === 'owner' || role === 'production'
export const canWriteVendor = (role: string | null) => role === 'owner' || role === 'production' || role === 'ops'
export const canWriteCost = (role: string | null) => role === 'owner' || role === 'production' || role === 'inventory'
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/auth/role.ts
git commit -m "feat: production role helpers (canWriteProduction/Vendor/Cost)"
```

---

### Task 4: Sidebar — gate Produksi group

**Files:**
- Modify: `src/components/SideNav.tsx`

**Interfaces:**
- Consumes: existing `roles?: string[]` per-item filter + `role` prop.
- Produces: Produksi (Produksi, Vendor) hidden for sales/inventory/finance/viewer.

- [ ] **Step 1: Add `roles` to the Produksi group items**

In `src/components/SideNav.tsx`, find:

```tsx
  { title: 'Produksi', items: [{ label: 'Produksi', href: '/production' }, { label: 'Vendor', href: '/vendors' }] },
```

Replace with:

```tsx
  { title: 'Produksi', items: [
      { label: 'Produksi', href: '/production', roles: ['owner', 'production', 'ops'] },
      { label: 'Vendor', href: '/vendors', roles: ['owner', 'production', 'ops'] },
    ] },
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/SideNav.tsx
git commit -m "feat: gate Produksi menu group to owner/production/ops"
```

---

### Task 5: UI write-control gating

**Files:**
- Modify: `src/app/(app)/production/page.tsx`
- Modify: `src/app/(app)/production/[id]/page.tsx`
- Modify: `src/app/(app)/production/[id]/StageButtons.tsx`
- Modify: `src/app/(app)/production/[id]/ProdLineRow.tsx`
- Modify: `src/app/(app)/vendors/page.tsx`

**Interfaces:**
- Consumes: `getRole`, `canWriteProduction`, `canWriteVendor`, `canWriteCost` from `@/lib/auth/role` (Task 3).
- Produces: create-order link, stage transitions, QC line edits, cost form, vendor form all render only for their write roles; view roles see read-only.

- [ ] **Step 1: `production/page.tsx` — gate `+ Order Produksi`**

Change the import line:

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteProduction } from '@/lib/auth/role'
import { STAGE_META } from '@/lib/ui'
```

After `const supabase = await createClient()` add:

```tsx
  const canWrite = canWriteProduction(await getRole())
```

Replace the `+ Order Produksi` link:

```tsx
        {canWrite && <Link href="/production/new" className="vb-btn">+ Order Produksi</Link>}
```

- [ ] **Step 2: `production/[id]/page.tsx` — compute + pass down flags**

This file already imports `getRole, canApprove` and fetches `const role = await getRole()`. Change the import line to also bring the new helpers:

```tsx
import { getRole, canApprove, canWriteProduction, canWriteCost } from '@/lib/auth/role'
```

Right after the existing `const role = await getRole()` line, add:

```tsx
  const canWriteProd = canWriteProduction(role)
  const canWriteCostEntry = canWriteCost(role)
```

Change `<StageButtons poId={po.id} stage={po.stage} />` to:

```tsx
      <StageButtons poId={po.id} stage={po.stage} canWrite={canWriteProd} />
```

Change the `<ProdLineRow ... />` usage (in the lines map) to pass `canWrite`:

```tsx
          <ProdLineRow key={l.id} id={l.id} sku_code={codeOf.get(l.sku_id) ?? l.sku_id}
            qty_ordered={l.qty_ordered} qty_received={l.qty_received} reject_count={l.reject_count} canWrite={canWriteProd} />
```

Replace the `<CostForm poId={po.id} />` usage with a conditional:

```tsx
        {canWriteCostEntry ? <CostForm poId={po.id} /> : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>Tambah Biaya</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya role Produksi/Inventory/Owner yang bisa menambah biaya.</div>
          </div>
        )}
```

- [ ] **Step 3: `StageButtons.tsx` — hide transition buttons when `!canWrite`**

Change the component signature:

```tsx
export default function StageButtons({ poId, stage, canWrite }: { poId: string; stage: string; canWrite: boolean }) {
```

Change the transition-options block condition from `{options.length > 0 && (` to also require `canWrite`:

```tsx
      {canWrite && options.length > 0 && (
```

(The progress bar above stays visible to everyone; only the `→ [stage]` action buttons are gated. The `canceled` early-return is unchanged.)

- [ ] **Step 4: `ProdLineRow.tsx` — read-only qty/reject when `!canWrite`**

Full new content:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProdLine } from '@/lib/production/actions'

type Props = { id: string; sku_code: string; qty_ordered: number; qty_received: number; reject_count: number; canWrite: boolean }

export default function ProdLineRow({ id, sku_code, qty_ordered, qty_received, reject_count, canWrite }: Props) {
  const router = useRouter()
  const [recv, setRecv] = useState(String(qty_received))
  const [rej, setRej] = useState(String(reject_count))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    await updateProdLine({ id, qty_received: parseInt(recv, 10) || 0, reject_count: parseInt(rej, 10) || 0 })
    setBusy(false)
    router.refresh()
  }

  if (!canWrite) {
    return (
      <div className="vb-row" style={{ gridTemplateColumns: '1.5fr 90px 110px 100px 90px' }}>
        <div className="vb-mono" style={{ fontWeight: 500 }}>{sku_code}</div>
        <div className="vb-mono" style={{ textAlign: 'right' }}>{qty_ordered}</div>
        <div className="vb-mono">{qty_received}</div>
        <div className="vb-mono">{reject_count}</div>
        <div />
      </div>
    )
  }

  return (
    <div className="vb-row" style={{ gridTemplateColumns: '1.5fr 90px 110px 100px 90px' }}>
      <div className="vb-mono" style={{ fontWeight: 500 }}>{sku_code}</div>
      <div className="vb-mono" style={{ textAlign: 'right' }}>{qty_ordered}</div>
      <input className="vb-input" style={{ width: 84, padding: '6px 9px', fontSize: 12.5 }} value={recv} onChange={(e) => setRecv(e.target.value)} />
      <input className="vb-input" style={{ width: 74, padding: '6px 9px', fontSize: 12.5 }} value={rej} onChange={(e) => setRej(e.target.value)} />
      <button className="vb-btn-mini" type="button" disabled={busy} onClick={save}>Simpan</button>
    </div>
  )
}
```

- [ ] **Step 5: `vendors/page.tsx` — gate VendorForm**

Change the import line:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteVendor } from '@/lib/auth/role'
import VendorForm from './VendorForm'
```

After `const supabase = await createClient()` add:

```tsx
  const canWrite = canWriteVendor(await getRole())
```

Replace the `<VendorForm />` usage:

```tsx
        {canWrite ? <VendorForm /> : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>Vendor Baru</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya role Produksi/Ops/Owner yang bisa menambah vendor.</div>
          </div>
        )}
```

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/production" "src/app/(app)/vendors"
git commit -m "feat: production UI role-gating (order/stage/QC/cost/vendor controls)"
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

- [ ] **Step 2: Start dev server** via preview tool (`{name: "dev"}`, port 3100). Fresh browser tab per login; if a login click doesn't redirect, `document.querySelector('form').requestSubmit()`.

- [ ] **Step 3: Log in as `prod.demo@vobia.test` / `password123`.** Verify:
  - Sidebar shows the Produksi group (Produksi, Vendor).
  - `/production`: `+ Order Produksi` visible; can create an order.
  - `/production/[id]`: stage transition buttons visible; prod-line rows have editable qty/reject + Simpan; Tambah Biaya form visible (production ∈ canWriteCost).
  - `/vendors`: Vendor Baru form visible; can add a vendor.

- [ ] **Step 4: Log in as `ops.demo@vobia.test` / `password123`.** Verify:
  - Sidebar shows the Produksi group (ops is a view role for orders + can write vendors).
  - `/production`: NO `+ Order Produksi` button; list read-only.
  - `/production/[id]`: NO stage transition buttons; prod-line rows show qty/reject as plain text (no inputs, no Simpan); Tambah Biaya shows the "Hanya role Produksi/Inventory/Owner…" note (ops ∉ canWriteCost).
  - `/vendors`: Vendor Baru form VISIBLE (ops ∈ canWriteVendor); can add a vendor.

- [ ] **Step 5: Log in as `sales.demo@vobia.test` / `password123`.** Verify:
  - Sidebar has NO Produksi group.
  - Direct URL `http://localhost:3100/production`: loads read-only, no create button.
  - Direct URL `http://localhost:3100/vendors`: loads, table visible, Vendor Baru shows the read-only note (sales ∉ canWriteVendor).

- [ ] **Step 6: Owner regression** — `superadmin@vobia.com`: Produksi fully writable, no regression across the app.

- [ ] **Step 7: Screenshots** of prod.demo vs ops.demo `/production/[id]` (write vs read-only) + ops vs sales `/vendors` (form vs note) as the artifact.
