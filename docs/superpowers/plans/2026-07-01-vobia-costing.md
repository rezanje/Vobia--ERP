# Vobia ERP Costing (HPP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute weighted-average actual HPP per SKU from production-order cost entries, shown live via a view.

**Architecture:** `cost_entries` attach costs to a production order (direct insert, `tenant_id` defaults from the JWT claim — no RPC). `sku_hpp` is a `security_invoker` view that allocates each PO's cost equally per received unit, then takes a per-SKU weighted average — always fresh, no Edge Function. UI: a Costs section on the production detail page and a `/costing` HPP table.

**Tech Stack:** Next.js 16, TypeScript, `@supabase/ssr`, Supabase Postgres (RLS + view), pgTAP, Playwright.

**Related spec:** `docs/superpowers/specs/2026-07-01-vobia-costing-design.md`

## Environment notes

- Export before DB steps: `export SUPABASE_DB_URL='postgresql://postgres.jchpnnrzcdicocbwtjac:<DB_PASSWORD>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres'`
- pgTAP: `npm run test:db <files>`. Types hand-written. Preview server may run on :3000 → verify with `npx tsc --noEmit` (not `npm run build`). Playwright reuses the running server.

---

## File Structure

```
supabase/migrations/20260701000011_cost_entries.sql   # cost_entries table + RLS + grants + sku_hpp view
supabase/tests/costing.test.sql                       # isolation + weighted-avg HPP
src/types/database.ts                                 # + cost_entries + sku_hpp
src/lib/costing/actions.ts                            # addCostEntry
src/app/(app)/costing/page.tsx                        # HPP table
src/app/(app)/production/[id]/CostForm.tsx            # add-cost form
src/app/(app)/production/[id]/page.tsx                # + Costs section (modified)
src/app/(app)/layout.tsx                              # + Costing nav link
e2e/costing.spec.ts
```

---

## Task 1: cost_entries table + sku_hpp view (TDD)

**Files:**
- Create: `supabase/migrations/20260701000011_cost_entries.sql`, `supabase/tests/costing.test.sql`

- [ ] **Step 1: Write the failing test**

`supabase/tests/costing.test.sql`:
```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('c9999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','co@c.test','{"tenant_name":"CO Co"}');

select set_config('request.jwt.claims',
  json_build_object('sub','c9999999-9999-9999-9999-999999999999','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='c9999999-9999-9999-9999-999999999999'))::text, true);
set local role authenticated;

do $$
declare
  v_vendor uuid; v_style uuid; v_sku uuid; v_po1 uuid; v_po2 uuid;
  v_hpp numeric; v_units int; v_cnt int;
begin
  insert into public.vendors (name) values ('CO Vendor') returning id into v_vendor;
  v_style := public.create_style_with_skus('CO-STY','CO Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  -- PO1: 100 received, cost 5000 -> per unit 50
  v_po1 := public.create_production_order(v_style, v_vendor, null, '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 100)));
  update public.prod_lines set qty_received = 100 where po_id = v_po1;
  perform public.transition_production_stage(v_po1, 'mass_production');
  perform public.transition_production_stage(v_po1, 'qc');
  perform public.transition_production_stage(v_po1, 'completed');
  insert into public.cost_entries (po_id, cost_type, amount) values (v_po1, 'material', 5000);

  select hpp, costed_units into v_hpp, v_units from public.sku_hpp where sku_id = v_sku;
  if v_hpp <> 50 then raise exception 'expected hpp 50, got %', v_hpp; end if;
  if v_units <> 100 then raise exception 'expected 100 costed units, got %', v_units; end if;

  -- PO2: another 100 received, cost 6000 -> weighted avg (5000+6000)/200 = 55
  v_po2 := public.create_production_order(v_style, v_vendor, null, '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 100)));
  update public.prod_lines set qty_received = 100 where po_id = v_po2;
  perform public.transition_production_stage(v_po2, 'mass_production');
  perform public.transition_production_stage(v_po2, 'qc');
  perform public.transition_production_stage(v_po2, 'completed');
  insert into public.cost_entries (po_id, cost_type, amount) values (v_po2, 'material', 6000);

  select hpp, costed_units into v_hpp, v_units from public.sku_hpp where sku_id = v_sku;
  if v_hpp <> 55 then raise exception 'expected hpp 55, got %', v_hpp; end if;
  if v_units <> 200 then raise exception 'expected 200 costed units, got %', v_units; end if;

  -- RLS: user only sees own cost_entries (2 inserted)
  select count(*) into v_cnt from public.cost_entries;
  if v_cnt <> 2 then raise exception 'expected 2 own cost_entries, got %', v_cnt; end if;

  raise notice 'costing OK: hpp 50 -> 55 weighted avg, RLS-scoped';
end $$;

rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db supabase/tests/costing.test.sql`
Expected: FAIL — `relation "public.cost_entries" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260701000011_cost_entries.sql`:
```sql
create table public.cost_entries (
  id uuid primary key default gen_random_uuid(),
  -- ponytail: cross-tenant cost attach would need guessing a PO's uuid (RLS hides
  -- other tenants' POs). Add a validating trigger only if that becomes a real vector.
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  po_id uuid not null references public.production_orders(id) on delete cascade,
  cost_type text not null check (cost_type in ('material','cmt','overhead','other')),
  amount numeric(14,2) not null check (amount > 0),
  note text,
  created_at timestamptz not null default now()
);
create index cost_entries_po_id_idx on public.cost_entries(po_id);

alter table public.cost_entries enable row level security;
create policy tenant_isolation on public.cost_entries for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.cost_entries to authenticated;

create view public.sku_hpp with (security_invoker = on) as
with po_cost as (
  select po_id, sum(amount) as total_cost from public.cost_entries group by po_id
),
po_units as (
  select po_id, sum(qty_received) as units from public.prod_lines group by po_id
),
line_alloc as (
  select pl.tenant_id, pl.sku_id, pl.qty_received,
         coalesce(pc.total_cost, 0) / nullif(pu.units, 0) as per_unit
  from public.prod_lines pl
  join po_units pu on pu.po_id = pl.po_id
  left join po_cost pc on pc.po_id = pl.po_id
  where pl.qty_received > 0
)
select tenant_id, sku_id,
       round(sum(per_unit * qty_received) / nullif(sum(qty_received), 0), 2) as hpp,
       sum(qty_received)::int as costed_units
from line_alloc
group by tenant_id, sku_id;

grant select on public.sku_hpp to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/costing.test.sql`
Expected: `costing OK: hpp 50 -> 55 weighted avg, RLS-scoped`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000011_cost_entries.sql supabase/tests/costing.test.sql
git commit -m "feat: cost_entries + sku_hpp weighted-average view"
```

---

## Task 2: Extend hand-written types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add `cost_entries` to `Tables`**

Inside `Tables`, after the `prod_lines` block, add:
```ts
      cost_entries: {
        Row: { id: string; tenant_id: string; po_id: string; cost_type: string; amount: number; note: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; po_id: string; cost_type: string; amount: number; note?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; po_id?: string; cost_type?: string; amount?: number; note?: string | null; created_at?: string }
        Relationships: []
      }
```

- [ ] **Step 2: Add `sku_hpp` to `Views`**

Inside `Views`, after the `stock_balances` block, add:
```ts
      sku_hpp: {
        Row: { tenant_id: string | null; sku_id: string | null; hpp: number | null; costed_units: number | null }
        Relationships: []
      }
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`
Expected: No errors found.
```bash
git add src/types/database.ts
git commit -m "chore: hand-written types for costing"
```

---

## Task 3: Actions + Costing UI (dispatch to a subagent)

**Files:**
- Create: `src/lib/costing/actions.ts`, `src/app/(app)/costing/page.tsx`, `src/app/(app)/production/[id]/CostForm.tsx`
- Modify: `src/app/(app)/production/[id]/page.tsx`, `src/app/(app)/layout.tsx`

- [ ] **Step 1: Action** — `src/lib/costing/actions.ts`
```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addCostEntry(input: { po_id: string; cost_type: string; amount: number; note: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('cost_entries').insert({
    po_id: input.po_id, cost_type: input.cost_type, amount: input.amount, note: input.note || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/production/${input.po_id}`)
  revalidatePath('/costing')
}
```

- [ ] **Step 2: Nav** — in `src/app/(app)/layout.tsx`, after the `<Link href="/vendors">Vendors</Link>` line add:
```tsx
        <Link href="/costing">Costing</Link>
```

- [ ] **Step 3: Cost form** — `src/app/(app)/production/[id]/CostForm.tsx`
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addCostEntry } from '@/lib/costing/actions'

const TYPES = ['material', 'cmt', 'overhead', 'other']

export default function CostForm({ poId }: { poId: string }) {
  const router = useRouter()
  const [type, setType] = useState('material')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    const a = Number(amount)
    if (!(a > 0)) { setError('Amount must be > 0'); return }
    setSaving(true)
    const res = await addCostEntry({ po_id: poId, cost_type: type, amount: a, note: note.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setAmount(''); setNote(''); router.refresh()
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
      <select className="vb-input" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value)}>
        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input className="vb-input" style={{ width: 140 }} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input className="vb-input" style={{ flex: 1, minWidth: 160 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Add cost'}</button>
      {error && <div style={{ color: '#ff9b9b', width: '100%' }}>{error}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Add the Costs section to the production detail page** — replace the ENTIRE contents of `src/app/(app)/production/[id]/page.tsx` with:
```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StageButtons from './StageButtons'
import ProdLineRow from './ProdLineRow'
import CostForm from './CostForm'

export default async function ProductionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: po } = await supabase.from('production_orders').select('*').eq('id', id).single()
  if (!po) notFound()

  const { data: lines } = await supabase.from('prod_lines').select('id, sku_id, qty_ordered, qty_received, reject_count').eq('po_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  const { data: costs } = await supabase.from('cost_entries').select('id, cost_type, amount, note').eq('po_id', id)
  const totalCost = (costs ?? []).reduce((s, c) => s + Number(c.amount), 0)

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>{po.code}</h1>
      <p style={{ color: 'var(--vb-muted)', marginBottom: 20 }}>{po.deadline ? `Deadline ${po.deadline}` : 'No deadline'}{po.notes ? ` · ${po.notes}` : ''}</p>

      <StageButtons poId={po.id} stage={po.stage} />

      <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Lines (edit received/rejects, then transition to completed to post stock)</div>
      <div className="vb-card" style={{ marginBottom: 24 }}>
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

      <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Costs — total {totalCost.toLocaleString()}</div>
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Type</th><th style={{ padding: 12 }}>Amount</th><th style={{ padding: 12 }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {!costs?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={3}>No costs yet.</td></tr>
            ) : costs.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12 }}>{c.cost_type}</td>
                <td style={{ padding: 12 }}>{Number(c.amount).toLocaleString()}</td>
                <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{c.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: 12 }}><CostForm poId={po.id} /></div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Costing page** — `src/app/(app)/costing/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server'

export default async function CostingPage() {
  const supabase = await createClient()
  const { data: hpp } = await supabase.from('sku_hpp').select('sku_id, hpp, costed_units')
  const { data: skus } = await supabase.from('skus').select('id, sku_code')
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>Costing (HPP)</h1>
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>HPP</th><th style={{ padding: 12 }}>Costed units</th>
            </tr>
          </thead>
          <tbody>
            {!hpp?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={3}>No costed SKUs yet.</td></tr>
            ) : hpp.map((h) => (
              <tr key={h.sku_id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{codeOf.get(h.sku_id ?? '') ?? h.sku_id}</td>
                <td style={{ padding: 12 }}>{h.hpp === null ? '—' : Number(h.hpp).toLocaleString()}</td>
                <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{h.costed_units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Verify + commit + push**

Run: `npx tsc --noEmit` → No errors found.
```bash
git add src/lib/costing "src/app/(app)/costing" "src/app/(app)/production/[id]/CostForm.tsx" "src/app/(app)/production/[id]/page.tsx" "src/app/(app)/layout.tsx"
git commit -m "feat: costing UI (cost entries on PO, HPP page)"
git push origin main
```

---

## Task 4: Playwright E2E

**Files:**
- Create: `e2e/costing.spec.ts`

- [ ] **Step 1: Write the E2E**

`e2e/costing.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('add cost on a completed PO shows HPP', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.co.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'CO E2E Co' },
  })
  expect(error).toBeNull()
  const userId = created!.user!.id

  try {
    await page.goto('/login')
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')
    await expect(page.getByText('Vobia ERP')).toBeVisible()

    await page.goto('/styles/new')
    await page.fill('input[placeholder="Style code (VB-MIRA)"]', 'CO-E2E')
    await page.fill('input[placeholder="Name"]', 'CO Top')
    await page.fill('input[placeholder="Color name (Black)"]', 'Black')
    await page.fill('input[placeholder="Code (BLK)"]', 'BLK')
    await page.getByRole('button', { name: /Save style/ }).click()
    await expect(page.getByText('CO-E2E-BLK-S')).toBeVisible()

    await page.goto('/vendors')
    await page.fill('input[placeholder="Name"]', 'Vendor CO')
    await page.getByRole('button', { name: 'Add vendor' }).click()
    await expect(page.getByRole('cell', { name: 'Vendor CO' })).toBeVisible()

    await page.goto('/production/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { index: 1 })
    await page.selectOption('select >> nth=2', { label: 'CO-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty ordered"]', '100')
    await page.getByRole('button', { name: 'Create order' }).click()

    await expect(page.getByText('CO-E2E-BLK-S')).toBeVisible()
    await page.locator('tbody input').first().fill('100')
    await page.getByRole('button', { name: 'Save' }).first().click()
    await page.getByRole('button', { name: '→ mass_production' }).click()
    await page.getByRole('button', { name: '→ qc' }).click()
    await page.getByRole('button', { name: '→ completed' }).click()

    // add a cost of 5000 -> HPP 50
    await page.fill('input[placeholder="Amount"]', '5000')
    await page.getByRole('button', { name: 'Add cost' }).click()
    await expect(page.getByRole('cell', { name: '5,000' }).first()).toBeVisible()

    await page.goto('/costing')
    await expect(page.getByRole('cell', { name: 'CO-E2E-BLK-S' })).toBeVisible()
    await expect(page.getByRole('cell', { name: '50', exact: true })).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
```

- [ ] **Step 2: Run**

Run: `set -a && . ./.env.local && set +a && npm run e2e -- e2e/costing.spec.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit + push**

```bash
git add e2e/costing.spec.ts
git commit -m "test: costing HPP E2E"
git push origin main
```

---

## Acceptance (whole sub-project)

- [ ] `npm run test:db supabase/tests/costing.test.sql` → `RESULT: PASS`.
- [ ] `npx tsc --noEmit` → No errors.
- [ ] `npm run e2e -- e2e/costing.spec.ts` → passes.
- [ ] Manual in preview: complete a PO, add a cost, `/costing` shows the HPP.
