# Vobia ERP Production & Vendor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track vendor production orders through a validated stage machine that auto-writes `production_in` to the stock ledger on completion.

**Architecture:** `vendors`, `production_orders`, `prod_lines` are tenant-scoped (RLS template). Two `SECURITY INVOKER` RPCs: `create_production_order` (stamps tenant, auto PO code, inserts lines) and `transition_production_stage` (validates the legal-transition map; on `completed`, calls `record_movement('production_in')` per prod_line with `qty_received`). The transition graph lives once in TS (`nextStages`) for the UI and mirrors the DB `CASE`. UI: `(app)/vendors` and `(app)/production/*` in the dark theme.

**Tech Stack:** Next.js 16, TypeScript, `@supabase/ssr`, Supabase Postgres (RLS + plpgsql RPC), pgTAP, Vitest, Playwright.

**Related spec:** `docs/superpowers/specs/2026-07-01-vobia-production-vendor-design.md`

## Environment notes

- Export before DB steps: `export SUPABASE_DB_URL='postgresql://postgres.jchpnnrzcdicocbwtjac:<DB_PASSWORD>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres'`
- pgTAP: `npm run test:db <files>`. Types hand-written in `src/types/database.ts`.
- A preview dev server may be running on :3000 → verify TS with `npx tsc --noEmit` (NOT `npm run build`). Playwright reuses the running server.

---

## File Structure

```
supabase/migrations/
  20260701000009_production_vendor.sql   # vendors, production_orders, prod_lines + RLS + grants
  20260701000010_production_fns.sql      # create_production_order, transition_production_stage
supabase/tests/production.test.sql
src/types/database.ts                    # + 3 tables + 2 functions
src/lib/production/stages.ts             # nextStages() transition map (+ .test.ts)
src/lib/production/actions.ts            # createVendor, createProductionOrder, updateProdLine, transitionStage
src/app/(app)/vendors/page.tsx + VendorForm.tsx
src/app/(app)/production/page.tsx
src/app/(app)/production/new/page.tsx + OrderForm.tsx
src/app/(app)/production/[id]/page.tsx + StageButtons.tsx + ProdLineRow.tsx
e2e/production.spec.ts
```

---

## Task 1: Schema + RLS (TDD)

**Files:**
- Create: `supabase/migrations/20260701000009_production_vendor.sql`, `supabase/tests/production.test.sql`

- [ ] **Step 1: Write the failing isolation test**

`supabase/tests/production.test.sql`:
```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a7777777-7777-7777-7777-777777777777','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pv_a@a.test','{"tenant_name":"PV A"}'),
  ('b8888888-8888-8888-8888-888888888888','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pv_b@b.test','{"tenant_name":"PV B"}');

insert into public.vendors (tenant_id, name)
  values ((select tenant_id from public.profiles where id='b8888888-8888-8888-8888-888888888888'), 'B Vendor');

select set_config('request.jwt.claims',
  json_build_object('sub','a7777777-7777-7777-7777-777777777777','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='a7777777-7777-7777-7777-777777777777'))::text, true);
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.vendors;
  if n <> 0 then raise exception 'RLS FAIL: tenant A sees % vendors from B', n; end if;
  raise notice 'PV RLS OK: tenant A sees 0 of tenant B vendors';
end $$;

rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db supabase/tests/production.test.sql`
Expected: FAIL — `relation "public.vendors" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260701000009_production_vendor.sql`:
```sql
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  name text not null,
  contact text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  style_id uuid not null references public.styles(id),
  vendor_id uuid not null references public.vendors(id),
  stage text not null default 'trial'
    check (stage in ('trial','mass_production','qc','completed','canceled')),
  deadline date,
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index production_orders_tenant_stage_idx on public.production_orders(tenant_id, stage);

create table public.prod_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  po_id uuid not null references public.production_orders(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  qty_ordered integer not null check (qty_ordered > 0),
  qty_received integer not null default 0 check (qty_received >= 0),
  reject_count integer not null default 0 check (reject_count >= 0),
  created_at timestamptz not null default now()
);
create index prod_lines_po_id_idx on public.prod_lines(po_id);

alter table public.vendors enable row level security;
alter table public.production_orders enable row level security;
alter table public.prod_lines enable row level security;

create policy tenant_isolation on public.vendors for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.production_orders for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.prod_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.vendors to authenticated;
grant select, insert, update, delete on public.production_orders to authenticated;
grant select, insert, update, delete on public.prod_lines to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/production.test.sql`
Expected: `PV RLS OK: tenant A sees 0 of tenant B vendors`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000009_production_vendor.sql supabase/tests/production.test.sql
git commit -m "feat: vendors/production_orders/prod_lines schema + RLS"
```

---

## Task 2: Production RPCs (TDD)

**Files:**
- Create: `supabase/migrations/20260701000010_production_fns.sql`
- Modify: `supabase/tests/production.test.sql`

- [ ] **Step 1: Append behavioral assertions**

Insert into `supabase/tests/production.test.sql` immediately BEFORE the final `rollback;`:
```sql
do $$
declare
  v_tenant uuid := (current_setting('request.jwt.claims')::json->>'tenant_id')::uuid;
  v_vendor uuid; v_style uuid; v_sku uuid; v_po uuid;
  v_stage text; v_lines int; v_bal int;
begin
  insert into public.vendors (tenant_id, name) values (v_tenant, 'Vendor A') returning id into v_vendor;
  v_style := public.create_style_with_skus('PV-STY','PV Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  v_po := public.create_production_order(v_style, v_vendor, current_date, 'note',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 100)));

  select stage into v_stage from public.production_orders where id = v_po;
  if v_stage <> 'trial' then raise exception 'expected trial, got %', v_stage; end if;
  select count(*) into v_lines from public.prod_lines where po_id = v_po;
  if v_lines <> 1 then raise exception 'expected 1 line, got %', v_lines; end if;

  -- style not in tenant -> raise
  begin
    perform public.create_production_order(gen_random_uuid(), v_vendor, null, '',
      jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 5)));
    raise exception 'STYLE_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%style not in tenant%' then raise; end if; end;

  -- illegal transition trial -> completed
  begin
    perform public.transition_production_stage(v_po, 'completed');
    raise exception 'TRANS_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%illegal transition%' then raise; end if; end;

  -- legal path -> set qty_received -> complete -> stock 90
  perform public.transition_production_stage(v_po, 'mass_production');
  perform public.transition_production_stage(v_po, 'qc');
  update public.prod_lines set qty_received = 90 where po_id = v_po;
  perform public.transition_production_stage(v_po, 'completed');

  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 90 then raise exception 'expected balance 90, got %', v_bal; end if;

  -- idempotent: already completed -> illegal, stock unchanged
  begin
    perform public.transition_production_stage(v_po, 'completed');
    raise exception 'IDEM_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%illegal transition%' then raise; end if; end;
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 90 then raise exception 'stock changed after idempotent complete: %', v_bal; end if;

  raise notice 'production OK: create, guard, legal/illegal transition, complete->stock 90, idempotent';
end $$;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db supabase/tests/production.test.sql`
Expected: FAIL — `function public.create_production_order(...) does not exist`.

- [ ] **Step 3: Write the RPC migration**

`supabase/migrations/20260701000010_production_fns.sql`:
```sql
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
  v_code text := 'PO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_po uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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

grant execute on function public.create_production_order(uuid, uuid, date, text, jsonb) to authenticated;

create or replace function public.transition_production_stage(
  p_po_id uuid,
  p_next_stage text
) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_current text;
  v_ok boolean;
  v_line record;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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

grant execute on function public.transition_production_stage(uuid, text) to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/production.test.sql`
Expected: `PV RLS OK...` and `production OK: create, guard, legal/illegal transition, complete->stock 90, idempotent`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000010_production_fns.sql supabase/tests/production.test.sql
git commit -m "feat: create_production_order + transition_production_stage (auto production_in on complete)"
```

---

## Task 3: Extend hand-written types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add tables**

Inside `Tables`, after the `stock_ledger` block, add:
```ts
      vendors: {
        Row: { id: string; tenant_id: string; name: string; contact: string | null; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; contact?: string | null; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; contact?: string | null; active?: boolean; created_at?: string }
        Relationships: []
      }
      production_orders: {
        Row: { id: string; tenant_id: string; code: string; style_id: string; vendor_id: string; stage: string; deadline: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; code: string; style_id: string; vendor_id: string; stage?: string; deadline?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; style_id?: string; vendor_id?: string; stage?: string; deadline?: string | null; notes?: string | null; created_at?: string }
        Relationships: []
      }
      prod_lines: {
        Row: { id: string; tenant_id: string; po_id: string; sku_id: string; qty_ordered: number; qty_received: number; reject_count: number; created_at: string }
        Insert: { id?: string; tenant_id: string; po_id: string; sku_id: string; qty_ordered: number; qty_received?: number; reject_count?: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; po_id?: string; sku_id?: string; qty_ordered?: number; qty_received?: number; reject_count?: number; created_at?: string }
        Relationships: []
      }
```

- [ ] **Step 2: Add functions**

Inside `Functions`, after the `record_movement` block, add:
```ts
      create_production_order: {
        Args: { p_style_id: string; p_vendor_id: string; p_deadline?: string | null; p_notes: string; p_lines: Json }
        Returns: string
      }
      transition_production_stage: {
        Args: { p_po_id: string; p_next_stage: string }
        Returns: undefined
      }
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`
Expected: No errors found.
```bash
git add src/types/database.ts
git commit -m "chore: hand-written types for production & vendor"
```

---

## Task 4: Stage transition map helper (TDD, Vitest)

**Files:**
- Create: `src/lib/production/stages.ts`, `src/lib/production/stages.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/production/stages.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { nextStages } from './stages'

describe('nextStages', () => {
  it('trial can go to mass_production or canceled', () => {
    expect(nextStages('trial')).toEqual(['mass_production', 'canceled'])
  })
  it('qc can complete, rework, or cancel', () => {
    expect(nextStages('qc')).toEqual(['completed', 'mass_production', 'canceled'])
  })
  it('terminal stages have no transitions', () => {
    expect(nextStages('completed')).toEqual([])
    expect(nextStages('canceled')).toEqual([])
  })
  it('unknown stage yields none', () => {
    expect(nextStages('bogus')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./stages`.

- [ ] **Step 3: Implement**

`src/lib/production/stages.ts`:
```ts
export const STAGES = ['trial', 'mass_production', 'qc', 'completed', 'canceled'] as const
export type Stage = (typeof STAGES)[number]

const TRANSITIONS: Record<Stage, Stage[]> = {
  trial: ['mass_production', 'canceled'],
  mass_production: ['qc', 'canceled'],
  qc: ['completed', 'mass_production', 'canceled'],
  completed: [],
  canceled: [],
}

export function nextStages(stage: string): Stage[] {
  return TRANSITIONS[stage as Stage] ?? []
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: skuCode 3 + nextStages 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/production/stages.ts src/lib/production/stages.test.ts
git commit -m "feat: production stage transition map + vitest"
```

---

## Task 5: Server actions + Production/Vendor UI (dispatch to a subagent)

This task is UI-heavy and fully specified. Provide the subagent the full code below. Verify with `npx tsc --noEmit` (NOT `npm run build` — a dev server is running). Commit + push.

**Files:**
- Create: `src/lib/production/actions.ts`, `src/app/(app)/vendors/page.tsx`, `src/app/(app)/vendors/VendorForm.tsx`, `src/app/(app)/production/page.tsx`, `src/app/(app)/production/new/page.tsx`, `src/app/(app)/production/new/OrderForm.tsx`, `src/app/(app)/production/[id]/page.tsx`, `src/app/(app)/production/[id]/StageButtons.tsx`, `src/app/(app)/production/[id]/ProdLineRow.tsx`
- Modify: `src/app/(app)/layout.tsx` (nav links)

- [ ] **Step 1: Server actions** — `src/lib/production/actions.ts`
```ts
'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createVendor(input: { name: string; contact: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('vendors').insert({ name: input.name, contact: input.contact || null })
  if (error) return { error: error.message }
  revalidatePath('/vendors')
}

export type LineInput = { sku_id: string; qty_ordered: number }

export async function createProductionOrder(input: {
  style_id: string; vendor_id: string; deadline: string; notes: string; lines: LineInput[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_production_order', {
    p_style_id: input.style_id,
    p_vendor_id: input.vendor_id,
    p_deadline: input.deadline || null,
    p_notes: input.notes,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/production/${data}`)
}

export async function updateProdLine(input: { id: string; qty_received: number; reject_count: number }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('prod_lines').update({ qty_received: input.qty_received, reject_count: input.reject_count }).eq('id', input.id)
  if (error) return { error: error.message }
  revalidatePath('/production')
}

export async function transitionStage(input: { po_id: string; next_stage: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('transition_production_stage', { p_po_id: input.po_id, p_next_stage: input.next_stage })
  if (error) return { error: error.message }
  revalidatePath('/production')
}
```

- [ ] **Step 2: Nav** — in `src/app/(app)/layout.tsx`, after the `<Link href="/stock">Stock</Link>` line add:
```tsx
        <Link href="/production">Production</Link>
        <Link href="/vendors">Vendors</Link>
```

- [ ] **Step 3: Vendors** — `src/app/(app)/vendors/VendorForm.tsx`
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createVendor } from '@/lib/production/actions'

export default function VendorForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    const res = await createVendor({ name: name.trim(), contact: contact.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); setContact(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16, maxWidth: 520, marginBottom: 24 }}>
      <div style={{ fontWeight: 500, marginBottom: 12 }}>New vendor</div>
      {error && <div style={{ color: '#ff9b9b', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input className="vb-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="vb-input" placeholder="Contact (optional)" value={contact} onChange={(e) => setContact(e.target.value)} />
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Add vendor'}</button>
      </div>
    </div>
  )
}
```
`src/app/(app)/vendors/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server'
import VendorForm from './VendorForm'

export default async function VendorsPage() {
  const supabase = await createClient()
  const { data: vendors } = await supabase.from('vendors').select('id, name, contact, active').order('name')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>Vendors</h1>
      <VendorForm />
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Name</th><th style={{ padding: 12 }}>Contact</th><th style={{ padding: 12 }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {!vendors?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={3}>No vendors yet.</td></tr>
            ) : vendors.map((v) => (
              <tr key={v.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12 }}>{v.name}</td>
                <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{v.contact ?? '—'}</td>
                <td style={{ padding: 12 }}>{v.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Production list** — `src/app/(app)/production/page.tsx`
```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function ProductionPage() {
  const supabase = await createClient()
  const { data: orders } = await supabase
    .from('production_orders').select('id, code, stage, deadline, style_id, vendor_id')
    .order('created_at', { ascending: false })
  const { data: styles } = await supabase.from('styles').select('id, code')
  const { data: vendors } = await supabase.from('vendors').select('id, name')
  const styleCode = new Map((styles ?? []).map((s) => [s.id, s.code]))
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Production</h1>
        <Link href="/production/new" className="vb-btn" style={{ textDecoration: 'none' }}>New order</Link>
      </div>
      {!orders?.length ? (
        <p style={{ color: 'var(--vb-muted)' }}>No production orders yet.</p>
      ) : (
        <div className="vb-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Code</th><th style={{ padding: 12 }}>Style</th>
                <th style={{ padding: 12 }}>Vendor</th><th style={{ padding: 12 }}>Stage</th><th style={{ padding: 12 }}>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}><Link href={`/production/${o.id}`} style={{ color: 'var(--vb-accent)' }}>{o.code}</Link></td>
                  <td style={{ padding: 12 }}>{styleCode.get(o.style_id) ?? '—'}</td>
                  <td style={{ padding: 12 }}>{vendorName.get(o.vendor_id) ?? '—'}</td>
                  <td style={{ padding: 12 }}><span className="vb-chip on">{o.stage}</span></td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{o.deadline ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: New order** — `src/app/(app)/production/new/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server'
import OrderForm from './OrderForm'

export default async function NewOrderPage() {
  const supabase = await createClient()
  const { data: styles } = await supabase.from('styles').select('id, code, name').order('code')
  const { data: vendors } = await supabase.from('vendors').select('id, name').order('name')
  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>New production order</h1>
      <OrderForm styles={styles ?? []} vendors={vendors ?? []} skus={skus ?? []} />
    </div>
  )
}
```
`src/app/(app)/production/new/OrderForm.tsx`
```tsx
'use client'
import { useState } from 'react'
import { createProductionOrder, type LineInput } from '@/lib/production/actions'

type Opt = { id: string; code?: string; name?: string; sku_code?: string }

export default function OrderForm({ styles, vendors, skus }: { styles: Opt[]; vendors: Opt[]; skus: Opt[] }) {
  const [styleId, setStyleId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku_id: string; qty: string }[]>([{ sku_id: '', qty: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!styleId) { setError('Pick a style'); return }
    if (!vendorId) { setError('Pick a vendor'); return }
    const parsed: LineInput[] = []
    for (const l of lines) {
      if (!l.sku_id) continue
      const q = parseInt(l.qty, 10)
      if (!Number.isInteger(q) || q <= 0) { setError('Each line needs a positive qty'); return }
      parsed.push({ sku_id: l.sku_id, qty_ordered: q })
    }
    if (!parsed.length) { setError('Add at least one line'); return }
    setSaving(true)
    const res = await createProductionOrder({ style_id: styleId, vendor_id: vendorId, deadline, notes, lines: parsed })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      {error && <div style={{ color: '#ff9b9b' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <select className="vb-input" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
          <option value="">Select style…</option>
          {styles.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </select>
        <select className="vb-input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">Select vendor…</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input className="vb-input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <input className="vb-input" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Lines</div>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <select className="vb-input" value={l.sku_id} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, sku_id: e.target.value } : x))}>
              <option value="">Select SKU…</option>
              {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
            </select>
            <input className="vb-input" placeholder="Qty ordered" value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
            <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => [...p, { sku_id: '', qty: '' }])}>+ line</button>
      </div>
      <div><button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Create order'}</button></div>
    </div>
  )
}
```

- [ ] **Step 6: Detail + stage buttons + prod-line editor**

`src/app/(app)/production/[id]/StageButtons.tsx`
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { transitionStage } from '@/lib/production/actions'
import { nextStages } from '@/lib/production/stages'

export default function StageButtons({ poId, stage }: { poId: string; stage: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const options = nextStages(stage)

  async function go(next: string) {
    setError(null); setBusy(true)
    const res = await transitionStage({ po_id: poId, next_stage: next })
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    router.refresh()
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="vb-chip on">{stage}</span>
        {options.map((s) => (
          <button key={s} className="vb-btn-ghost" type="button" disabled={busy} onClick={() => go(s)}>→ {s}</button>
        ))}
      </div>
      {error && <div style={{ color: '#ff9b9b', marginTop: 8 }}>{error}</div>}
    </div>
  )
}
```
`src/app/(app)/production/[id]/ProdLineRow.tsx`
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProdLine } from '@/lib/production/actions'

type Props = { id: string; sku_code: string; qty_ordered: number; qty_received: number; reject_count: number }

export default function ProdLineRow({ id, sku_code, qty_ordered, qty_received, reject_count }: Props) {
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

  return (
    <tr style={{ borderTop: '1px solid var(--vb-border)' }}>
      <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{sku_code}</td>
      <td style={{ padding: 12 }}>{qty_ordered}</td>
      <td style={{ padding: 12 }}><input className="vb-input" style={{ width: 80 }} value={recv} onChange={(e) => setRecv(e.target.value)} /></td>
      <td style={{ padding: 12 }}><input className="vb-input" style={{ width: 80 }} value={rej} onChange={(e) => setRej(e.target.value)} /></td>
      <td style={{ padding: 12 }}><button className="vb-btn-ghost" type="button" disabled={busy} onClick={save}>Save</button></td>
    </tr>
  )
}
```
`src/app/(app)/production/[id]/page.tsx`
```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StageButtons from './StageButtons'
import ProdLineRow from './ProdLineRow'

export default async function ProductionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: po } = await supabase.from('production_orders').select('*').eq('id', id).single()
  if (!po) notFound()

  const { data: lines } = await supabase.from('prod_lines').select('id, sku_id, qty_ordered, qty_received, reject_count').eq('po_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>{po.code}</h1>
      <p style={{ color: 'var(--vb-muted)', marginBottom: 20 }}>{po.deadline ? `Deadline ${po.deadline}` : 'No deadline'}{po.notes ? ` · ${po.notes}` : ''}</p>

      <StageButtons poId={po.id} stage={po.stage} />

      <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Lines (edit received/rejects, then transition to completed to post stock)</div>
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Ordered</th>
              <th style={{ padding: 12 }}>Received</th><th style={{ padding: 12 }}>Rejects</th><th style={{ padding: 12 }}></th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <ProdLineRow key={l.id} id={l.id} sku_code={codeOf.get(l.sku_id) ?? l.sku_id}
                qty_ordered={l.qty_ordered} qty_received={l.qty_received} reject_count={l.reject_count} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Verify + commit + push**

Run: `npx tsc --noEmit` → No errors found.
```bash
git add src/lib/production/actions.ts "src/app/(app)/vendors" "src/app/(app)/production" "src/app/(app)/layout.tsx"
git commit -m "feat: production & vendor UI (orders, stage machine, prod-line editor)"
git push origin main
```

---

## Task 6: Playwright E2E

**Files:**
- Create: `e2e/production.spec.ts`

- [ ] **Step 1: Write the E2E**

`e2e/production.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('production order completes and posts stock', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.pv.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'PV E2E Co' },
  })
  expect(error).toBeNull()
  const userId = created!.user!.id

  try {
    await page.goto('/login')
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')
    await expect(page.getByText('Vobia ERP')).toBeVisible()

    // style + sku
    await page.goto('/styles/new')
    await page.fill('input[placeholder="Style code (VB-MIRA)"]', 'PV-E2E')
    await page.fill('input[placeholder="Name"]', 'PV Top')
    await page.fill('input[placeholder="Color name (Black)"]', 'Black')
    await page.fill('input[placeholder="Code (BLK)"]', 'BLK')
    await page.getByRole('button', { name: /Save style/ }).click()
    await expect(page.getByText('PV-E2E-BLK-S')).toBeVisible()

    // vendor
    await page.goto('/vendors')
    await page.fill('input[placeholder="Name"]', 'Vendor E2E')
    await page.getByRole('button', { name: 'Add vendor' }).click()
    await expect(page.getByRole('cell', { name: 'Vendor E2E' })).toBeVisible()

    // production order
    await page.goto('/production/new')
    await page.selectOption('select >> nth=0', { label: /PV-E2E/ })
    await page.selectOption('select >> nth=1', { label: 'Vendor E2E' })
    await page.selectOption('select >> nth=2', { label: 'PV-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty ordered"]', '50')
    await page.getByRole('button', { name: 'Create order' }).click()

    // on detail: set received 50, then transition trial->mass->qc->completed
    await expect(page.getByText('PV-E2E-BLK-S')).toBeVisible()
    const recv = page.locator('tbody input').first()
    await recv.fill('50')
    await page.getByRole('button', { name: 'Save' }).first().click()
    await page.getByRole('button', { name: '→ mass_production' }).click()
    await page.getByRole('button', { name: '→ qc' }).click()
    await page.getByRole('button', { name: '→ completed' }).click()
    await expect(page.getByText('completed', { exact: true })).toBeVisible()

    // stock reflects 50
    await page.goto('/stock')
    await expect(page.getByRole('cell', { name: 'PV-E2E-BLK-S' }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: '50', exact: true }).first()).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
```

- [ ] **Step 2: Run**

Run: `set -a && . ./.env.local && set +a && npm run e2e -- e2e/production.spec.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit + push**

```bash
git add e2e/production.spec.ts
git commit -m "test: production order -> complete -> stock E2E"
git push origin main
```

---

## Acceptance (whole sub-project)

- [ ] `npm run test:db supabase/tests/production.test.sql` → `RESULT: PASS`.
- [ ] `npm test` → skuCode + nextStages pass.
- [ ] `npm run e2e -- e2e/production.spec.ts` → passes.
- [ ] `npx tsc --noEmit` → No errors.
- [ ] Manual in preview: create vendor + style, create PO, set received, walk stages to completed, see `/stock` updated.
