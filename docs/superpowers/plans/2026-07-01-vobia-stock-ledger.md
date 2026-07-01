# Vobia ERP Stock Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the append-only stock ledger with a single DB-enforced write path (`record_movement`), a real-time balances view, and a read-only Stock UI with a manual adjustment form.

**Architecture:** `stock_ledger` is append-only — direct INSERT/UPDATE/DELETE is revoked from `authenticated`; the only writer is `record_movement()`, a `SECURITY DEFINER` function that stamps `tenant_id`/`created_by` from the JWT, enforces the SKU belongs to the caller's tenant, and normalizes sign by movement type. `stock_balances` is a `security_invoker` view summing qty per SKU. UI: a `(app)/stock` page showing balances + recent movements + an adjustment form.

**Tech Stack:** Next.js 16, TypeScript, `@supabase/ssr`, Supabase Postgres (RLS + plpgsql SECURITY DEFINER RPC), pgTAP, Playwright.

**Related spec:** `docs/superpowers/specs/2026-07-01-vobia-stock-ledger-design.md`

## Environment notes

- Export the pooler URI before DB steps: `export SUPABASE_DB_URL='postgresql://postgres.jchpnnrzcdicocbwtjac:<DB_PASSWORD>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres'`
- pgTAP via `npm run test:db <files>` (committed `scripts/pgtap.mjs`).
- Types hand-written in `src/types/database.ts`.
- **A preview dev server may be running on :3000.** Verify TS with `npx tsc --noEmit` (NOT `npm run build`, which fights the dev server's `.next`). Playwright reuses the running server (`reuseExistingServer`).

---

## File Structure

```
supabase/migrations/
  20260701000007_stock_ledger.sql       # table, RLS(select), revokes, balances view, grants
  20260701000008_record_movement_fn.sql # record_movement SECURITY DEFINER RPC
supabase/tests/
  stock_ledger.test.sql                 # append-only, isolation, sign, cross-tenant, adjustment reason
src/types/database.ts                   # + stock_ledger, stock_balances, record_movement
src/lib/stock/actions.ts                # recordAdjustment server action
src/app/(app)/stock/page.tsx            # balances + movements + form
src/app/(app)/stock/AdjustForm.tsx      # client adjustment form
e2e/stock-ledger.spec.ts                # Playwright
```

---

## Task 1: stock_ledger schema, append-only enforcement, balances view (TDD)

**Files:**
- Create: `supabase/migrations/20260701000007_stock_ledger.sql`, `supabase/tests/stock_ledger.test.sql`

- [ ] **Step 1: Write the failing pgTAP test (schema + append-only)**

`supabase/tests/stock_ledger.test.sql`:
```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('e5555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','sl@s.test','{"tenant_name":"SL Co"}');

select set_config('request.jwt.claims',
  json_build_object('sub','e5555555-5555-5555-5555-555555555555','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='e5555555-5555-5555-5555-555555555555'))::text, true);
set local role authenticated;

do $$
begin
  -- direct INSERT is revoked -> append-only via record_movement only
  begin
    insert into public.stock_ledger (tenant_id, sku_id, qty, movement_type, reason)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 5, 'adjustment', 'x');
    raise exception 'expected permission denied on direct insert';
  exception when insufficient_privilege then null;
  end;

  -- UPDATE and DELETE also revoked
  begin
    update public.stock_ledger set qty = 1;
    raise exception 'expected permission denied on update';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.stock_ledger;
    raise exception 'expected permission denied on delete';
  exception when insufficient_privilege then null;
  end;

  raise notice 'append-only OK: direct insert/update/delete denied';
end $$;

rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db supabase/tests/stock_ledger.test.sql`
Expected: FAIL — `relation "public.stock_ledger" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260701000007_stock_ledger.sql`:
```sql
create table public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  sku_id uuid not null references public.skus(id),
  qty integer not null,
  movement_type text not null
    check (movement_type in ('production_in','sale_out','return_in','adjustment')),
  reason text,
  ref_type text,
  ref_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint qty_nonzero check (qty <> 0),
  constraint adjustment_reason check (
    movement_type <> 'adjustment' or (reason is not null and trim(reason) <> '')
  )
);
create index stock_ledger_sku_id_idx on public.stock_ledger(sku_id);
create index stock_ledger_tenant_created_idx on public.stock_ledger(tenant_id, created_at desc);

alter table public.stock_ledger enable row level security;
create policy tenant_isolation on public.stock_ledger
  for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- append-only: no direct writes; record_movement() is the only writer
revoke insert, update, delete on public.stock_ledger from authenticated;
grant select on public.stock_ledger to authenticated;

create view public.stock_balances with (security_invoker = on) as
select sku_id, tenant_id, sum(qty)::int as balance
from public.stock_ledger
group by sku_id, tenant_id;

grant select on public.stock_balances to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/stock_ledger.test.sql`
Expected: `append-only OK: direct insert/update/delete denied`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000007_stock_ledger.sql supabase/tests/stock_ledger.test.sql
git commit -m "feat: append-only stock_ledger + balances view (writes revoked)"
```

---

## Task 2: record_movement RPC (TDD)

**Files:**
- Create: `supabase/migrations/20260701000008_record_movement_fn.sql`
- Modify: `supabase/tests/stock_ledger.test.sql`

- [ ] **Step 1: Append behavioral assertions to the test**

Insert the following into `supabase/tests/stock_ledger.test.sql` immediately BEFORE the final `rollback;` line. It returns to the privileged role (`reset role`) to seed a second tenant, then does everything inside one DO block so plpgsql variables survive the in-block role switch. Sentinels (`ADJ_SHOULD_FAIL`/`XT_SHOULD_FAIL`) are deliberately distinct from the real error text so a missing rejection can't false-pass:
```sql
reset role;
do $$
declare
  v_tenant_a uuid := (select tenant_id from public.profiles where id='e5555555-5555-5555-5555-555555555555');
  v_style uuid; v_sku uuid; v_bal int;
  v_other_tenant uuid; v_other_style uuid; v_other_cw uuid; v_other_sku uuid;
begin
  -- (running as postgres) seed a second tenant + a sku it owns
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
    values ('f6666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-000000000000',
            'authenticated','authenticated','sl_other@s.test','{"tenant_name":"SL Other"}');
  v_other_tenant := (select tenant_id from public.profiles where id='f6666666-6666-6666-6666-666666666666');
  insert into public.styles (tenant_id, code, name) values (v_other_tenant,'OTH','Oth') returning id into v_other_style;
  insert into public.colorways (tenant_id, style_id, color_name, color_code)
    values (v_other_tenant, v_other_style,'Red','RED') returning id into v_other_cw;
  insert into public.skus (tenant_id, colorway_id, size, sku_code)
    values (v_other_tenant, v_other_cw,'M','OTH-RED-M') returning id into v_other_sku;

  -- become tenant A (authenticated)
  perform set_config('request.jwt.claims',
    json_build_object('sub','e5555555-5555-5555-5555-555555555555','role','authenticated','tenant_id',v_tenant_a::text)::text, true);
  perform set_config('role','authenticated', true);

  -- seed a sku for A via the product-spine RPC (security invoker, RLS applies)
  v_style := public.create_style_with_skus('SL-STY','SL Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  -- production_in 10 -> +10 ; sale_out 3 -> -3 ; balance 7
  perform public.record_movement(v_sku, 10, 'production_in');
  perform public.record_movement(v_sku, 3, 'sale_out');
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 7 then raise exception 'expected balance 7, got %', v_bal; end if;
  if not exists (select 1 from public.stock_ledger where sku_id = v_sku and movement_type='sale_out' and qty = -3) then
    raise exception 'sale_out not stored as -3';
  end if;

  -- adjustment without reason -> record_movement raises "adjustment requires a reason"
  begin
    perform public.record_movement(v_sku, 5, 'adjustment');
    raise exception 'ADJ_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%requires a reason%' then raise; end if;
  end;

  -- cross-tenant sku -> record_movement raises "sku belongs to another tenant"
  begin
    perform public.record_movement(v_other_sku, 5, 'production_in');
    raise exception 'XT_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%another tenant%' then raise; end if;
  end;

  raise notice 'record_movement OK: balance 7, sign, adjustment-reason, cross-tenant enforced';
end $$;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db supabase/tests/stock_ledger.test.sql`
Expected: FAIL — `function public.record_movement(...) does not exist`.

- [ ] **Step 3: Write the RPC migration**

`supabase/migrations/20260701000008_record_movement_fn.sql`:
```sql
create or replace function public.record_movement(
  p_sku_id uuid,
  p_qty integer,
  p_movement_type text,
  p_reason text default null,
  p_ref_type text default null,
  p_ref_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_sku_tenant uuid;
  v_qty integer;
  v_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_qty = 0 then raise exception 'qty must be non-zero'; end if;
  if p_movement_type not in ('production_in','sale_out','return_in','adjustment') then
    raise exception 'invalid movement_type: %', p_movement_type;
  end if;

  select tenant_id into v_sku_tenant from public.skus where id = p_sku_id;
  if v_sku_tenant is null then raise exception 'sku not found'; end if;
  if v_sku_tenant <> v_tenant then raise exception 'sku belongs to another tenant'; end if;

  if p_movement_type = 'adjustment' then
    if p_reason is null or trim(p_reason) = '' then
      raise exception 'adjustment requires a reason';
    end if;
    v_qty := p_qty;
  elsif p_movement_type = 'sale_out' then
    v_qty := -abs(p_qty);
  else
    v_qty := abs(p_qty);
  end if;

  insert into public.stock_ledger (tenant_id, sku_id, qty, movement_type, reason, ref_type, ref_id, created_by)
  values (v_tenant, p_sku_id, v_qty, p_movement_type, p_reason, p_ref_type, p_ref_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_movement(uuid, integer, text, text, text, uuid) to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/stock_ledger.test.sql`
Expected: `append-only OK...` and `record_movement OK: balance 7, sign, adjustment-reason, cross-tenant enforced`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000008_record_movement_fn.sql supabase/tests/stock_ledger.test.sql
git commit -m "feat: record_movement RPC (single write path, sign normalization, tenant guard)"
```

---

## Task 3: Extend hand-written types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add `stock_ledger` to `Tables`**

In `src/types/database.ts`, inside `Tables`, after the `skus` block, add:
```ts
      stock_ledger: {
        Row: { id: string; tenant_id: string; sku_id: string; qty: number; movement_type: string; reason: string | null; ref_type: string | null; ref_id: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; sku_id: string; qty: number; movement_type: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; sku_id?: string; qty?: number; movement_type?: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
```

- [ ] **Step 2: Add `stock_balances` to `Views`**

Inside the `Views` object, after the `style_summary` block, add:
```ts
      stock_balances: {
        Row: { sku_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
```

- [ ] **Step 3: Add `record_movement` to `Functions`**

Inside the `Functions` object, after the `create_style_with_skus` block, add:
```ts
      record_movement: {
        Args: { p_sku_id: string; p_qty: number; p_movement_type: string; p_reason?: string; p_ref_type?: string; p_ref_id?: string }
        Returns: string
      }
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors found.

- [ ] **Step 5: Commit**

```bash
git add src/types/database.ts
git commit -m "chore: hand-written types for stock ledger"
```

---

## Task 4: Server action + Stock UI

**Files:**
- Create: `src/lib/stock/actions.ts`, `src/app/(app)/stock/page.tsx`, `src/app/(app)/stock/AdjustForm.tsx`
- Modify: `src/app/(app)/layout.tsx` (add Stock nav link)

- [ ] **Step 1: Server action**

`src/lib/stock/actions.ts`:
```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function recordAdjustment(input: {
  sku_id: string
  qty: number
  reason: string
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('record_movement', {
    p_sku_id: input.sku_id,
    p_qty: input.qty,
    p_movement_type: 'adjustment',
    p_reason: input.reason,
  })
  if (error) return { error: error.message }
  revalidatePath('/stock')
}
```

- [ ] **Step 2: Add Stock to the nav**

In `src/app/(app)/layout.tsx`, add a link after the Styles link:
```tsx
        <Link href="/stock">Stock</Link>
```

- [ ] **Step 3: Client adjustment form**

`src/app/(app)/stock/AdjustForm.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordAdjustment } from '@/lib/stock/actions'

type SkuOption = { id: string; sku_code: string }

export default function AdjustForm({ skus }: { skus: SkuOption[] }) {
  const router = useRouter()
  const [skuId, setSkuId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    const n = parseInt(qty, 10)
    if (!skuId) { setError('Pick a SKU'); return }
    if (!Number.isInteger(n) || n === 0) { setError('Qty must be a non-zero integer'); return }
    if (!reason.trim()) { setError('Reason is required'); return }
    setSaving(true)
    const res = await recordAdjustment({ sku_id: skuId, qty: n, reason: reason.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setQty(''); setReason('')
    router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16, maxWidth: 520, marginBottom: 24 }}>
      <div style={{ fontWeight: 500, marginBottom: 12 }}>Adjustment</div>
      {error && <div style={{ color: '#ff9b9b', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <select className="vb-input" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
          <option value="">Select SKU…</option>
          {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
        </select>
        <input className="vb-input" placeholder="Qty (e.g. 15 or -5)" value={qty} onChange={(e) => setQty(e.target.value)} />
        <input className="vb-input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Record adjustment'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Stock page**

`src/app/(app)/stock/page.tsx`:
```tsx
import { createClient } from '@/lib/supabase/server'
import AdjustForm from './AdjustForm'

export default async function StockPage() {
  const supabase = await createClient()

  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  const { data: balances } = await supabase.from('stock_balances').select('sku_id, balance')
  const { data: movements } = await supabase
    .from('stock_ledger')
    .select('id, sku_id, qty, movement_type, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>Stock</h1>

      <AdjustForm skus={skus ?? []} />

      <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Balances</div>
      <div className="vb-card" style={{ marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {!balances?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={2}>No movements yet.</td></tr>
            ) : balances.map((b) => (
              <tr key={b.sku_id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12 }}>{codeOf.get(b.sku_id ?? '') ?? b.sku_id}</td>
                <td style={{ padding: 12, color: (b.balance ?? 0) < 0 ? '#ff9b9b' : 'var(--vb-text)' }}>{b.balance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Recent movements</div>
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Type</th>
              <th style={{ padding: 12 }}>Qty</th><th style={{ padding: 12 }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {!movements?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={4}>No movements yet.</td></tr>
            ) : movements.map((m) => (
              <tr key={m.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12 }}>{codeOf.get(m.sku_id) ?? m.sku_id}</td>
                <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{m.movement_type}</td>
                <td style={{ padding: 12 }}>{m.qty}</td>
                <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{m.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors found.

- [ ] **Step 6: Commit + push**

```bash
git add src/lib/stock "src/app/(app)/stock" "src/app/(app)/layout.tsx"
git commit -m "feat: stock page (balances, movements, adjustment form) + nav"
git push origin main
```

---

## Task 5: Playwright E2E

**Files:**
- Create: `e2e/stock-ledger.spec.ts`

- [ ] **Step 1: Write the E2E**

`e2e/stock-ledger.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('adjustment updates the stock balance', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.sl.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'SL E2E Co' },
  })
  expect(error).toBeNull()
  const userId = created!.user!.id

  try {
    // log in
    await page.goto('/login')
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')
    await expect(page.getByText('Vobia ERP')).toBeVisible()

    // create a style so a SKU exists
    await page.goto('/styles/new')
    await page.fill('input[placeholder="Style code (VB-MIRA)"]', 'SL-E2E')
    await page.fill('input[placeholder="Name"]', 'SL Top')
    await page.fill('input[placeholder="Color name (Black)"]', 'Black')
    await page.fill('input[placeholder="Code (BLK)"]', 'BLK')
    await page.getByRole('button', { name: /Save style/ }).click()
    await expect(page.getByText('SL-E2E-BLK-S')).toBeVisible()

    // record an adjustment of +15
    await page.goto('/stock')
    await page.selectOption('select', { label: 'SL-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty (e.g. 15 or -5)"]', '15')
    await page.fill('input[placeholder="Reason"]', 'initial count')
    await page.getByRole('button', { name: 'Record adjustment' }).click()

    // balance row shows 15
    await expect(page.getByRole('cell', { name: 'SL-E2E-BLK-S' }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: '15', exact: true })).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
```

- [ ] **Step 2: Run it**

Run: `set -a && . ./.env.local && set +a && npm run e2e -- e2e/stock-ledger.spec.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit + push**

```bash
git add e2e/stock-ledger.spec.ts
git commit -m "test: stock ledger adjustment E2E"
git push origin main
```

---

## Acceptance (whole sub-project)

- [ ] `npm run test:db supabase/tests/stock_ledger.test.sql` → `RESULT: PASS` (append-only, sign, cross-tenant, adjustment reason, balance).
- [ ] `npx tsc --noEmit` → No errors.
- [ ] `npm run e2e -- e2e/stock-ledger.spec.ts` → adjustment → balance passes.
- [ ] Manual in preview: create a style, go to /stock, adjust +15 then -20 → balance -5 shows red.
