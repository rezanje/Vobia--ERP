# Vobia ERP Returns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record customer returns against an order that immediately post `return_in` to the stock ledger per line (restock).

**Architecture:** `returns`, `return_lines` are tenant-scoped (RLS template). `create_return` is a `SECURITY INVOKER` RPC that stamps tenant, requires the order to belong to the tenant, auto-codes the return, inserts lines, and calls `record_movement('return_in')` per line. Mirror of `create_order` but positive. UI: `(app)/returns/*` in the dark theme.

**Tech Stack:** Next.js 16, TypeScript, `@supabase/ssr`, Supabase Postgres (RLS + RPC), pgTAP, Playwright.

**Related spec:** `docs/superpowers/specs/2026-07-01-vobia-returns-design.md`

## Environment notes

- Export before DB steps: `export SUPABASE_DB_URL='postgresql://postgres.jchpnnrzcdicocbwtjac:<DB_PASSWORD>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres'`
- pgTAP: `npm run test:db <files>`. Types hand-written. Verify TS with `npx tsc --noEmit`. Playwright uses its own dev server on **port 3100**.

---

## File Structure

```
supabase/migrations/20260701000014_returns.sql        # returns, return_lines + RLS + grants
supabase/migrations/20260701000015_return_fn.sql      # create_return RPC
supabase/tests/returns.test.sql
src/types/database.ts                                 # + 2 tables + create_return
src/lib/returns/actions.ts                            # createReturn
src/app/(app)/returns/page.tsx
src/app/(app)/returns/new/page.tsx + ReturnForm.tsx
src/app/(app)/returns/[id]/page.tsx
src/app/(app)/layout.tsx                              # + Returns nav
e2e/returns.spec.ts
```

---

## Task 1: Schema + RLS (TDD)

**Files:**
- Create: `supabase/migrations/20260701000014_returns.sql`, `supabase/tests/returns.test.sql`

- [ ] **Step 1: Write the failing isolation test**

`supabase/tests/returns.test.sql`:
```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a3030303-3030-3030-3030-303030303030','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ret_a@a.test','{"tenant_name":"RET A"}'),
  ('b4040404-4040-4040-4040-404040404040','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ret_b@b.test','{"tenant_name":"RET B"}');

do $$
declare
  v_a uuid := (select tenant_id from public.profiles where id='a3030303-3030-3030-3030-303030303030');
  v_b uuid := (select tenant_id from public.profiles where id='b4040404-4040-4040-4040-404040404040');
  v_b_ch uuid; v_b_ord uuid; v_cnt int;
begin
  -- seed a B return chain as postgres (bypass RLS)
  insert into public.channels (tenant_id, name) values (v_b, 'B Ch') returning id into v_b_ch;
  insert into public.orders (tenant_id, code, channel_id) values (v_b, 'B-ORD', v_b_ch) returning id into v_b_ord;
  insert into public.returns (tenant_id, code, order_id) values (v_b, 'B-RET', v_b_ord);

  -- become tenant A
  perform set_config('request.jwt.claims',
    json_build_object('sub','a3030303-3030-3030-3030-303030303030','role','authenticated','tenant_id',v_a::text)::text, true);
  perform set_config('role','authenticated', true);

  select count(*) into v_cnt from public.returns;
  if v_cnt <> 0 then raise exception 'RLS FAIL: tenant A sees % returns from B', v_cnt; end if;
  raise notice 'RET RLS OK: tenant A sees 0 of tenant B returns';
end $$;

rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db supabase/tests/returns.test.sql`
Expected: FAIL — `relation "public.returns" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260701000014_returns.sql`:
```sql
create table public.returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  order_id uuid not null references public.orders(id),
  return_date date not null default current_date,
  reason text,
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index returns_tenant_date_idx on public.returns(tenant_id, return_date desc);

create table public.return_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  return_id uuid not null references public.returns(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now()
);
create index return_lines_return_id_idx on public.return_lines(return_id);

alter table public.returns enable row level security;
alter table public.return_lines enable row level security;

create policy tenant_isolation on public.returns for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.return_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.returns to authenticated;
grant select, insert, update, delete on public.return_lines to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/returns.test.sql`
Expected: `RET RLS OK: tenant A sees 0 of tenant B returns`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000014_returns.sql supabase/tests/returns.test.sql
git commit -m "feat: returns/return_lines schema + RLS"
```

---

## Task 2: create_return RPC (TDD)

**Files:**
- Create: `supabase/migrations/20260701000015_return_fn.sql`
- Modify: `supabase/tests/returns.test.sql`

- [ ] **Step 1: Append behavioral assertions**

The isolation block already switched the session to tenant A. Insert this block into `supabase/tests/returns.test.sql` immediately BEFORE the final `rollback;` (it continues as tenant A):
```sql
do $$
declare
  v_a uuid := (current_setting('request.jwt.claims')::json->>'tenant_id')::uuid;
  v_channel uuid; v_style uuid; v_sku uuid; v_order uuid; v_ret uuid; v_bal int; v_lines int;
begin
  insert into public.channels (tenant_id, name) values (v_a, 'Shopee') returning id into v_channel;
  v_style := public.create_style_with_skus('RET-STY','RET Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  perform public.record_movement(v_sku, 100, 'production_in');
  v_order := public.create_order(v_channel, current_date, '', '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 30, 'unit_price', 0)));
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 70 then raise exception 'expected balance 70 after sale, got %', v_bal; end if;

  -- return 10 -> return_in +10 -> balance 80
  v_ret := public.create_return(v_order, current_date, 'defect', '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 10)));
  select count(*) into v_lines from public.return_lines where return_id = v_ret;
  if v_lines <> 1 then raise exception 'expected 1 return line, got %', v_lines; end if;
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 80 then raise exception 'expected balance 80 after return, got %', v_bal; end if;

  -- order not in tenant -> raise
  begin
    perform public.create_return(gen_random_uuid(), current_date, '', '',
      jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1)));
    raise exception 'ORD_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%order not in tenant%' then raise; end if; end;

  raise notice 'returns OK: return_in 70 -> 80, order guard';
end $$;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db supabase/tests/returns.test.sql`
Expected: FAIL — `function public.create_return(...) does not exist`.

- [ ] **Step 3: Write the RPC migration**

`supabase/migrations/20260701000015_return_fn.sql`:
```sql
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
  v_code text := 'RET-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_return uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
  v_qty int;
  v_line_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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

grant execute on function public.create_return(uuid, date, text, text, jsonb) to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/returns.test.sql`
Expected: `RET RLS OK...` and `returns OK: return_in 70 -> 80, order guard`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000015_return_fn.sql supabase/tests/returns.test.sql
git commit -m "feat: create_return RPC (return_in per line, order-scoped)"
```

---

## Task 3: Extend hand-written types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add tables** — inside `Tables`, after the `order_lines` block, add:
```ts
      returns: {
        Row: { id: string; tenant_id: string; code: string; order_id: string; return_date: string; reason: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; order_id: string; return_date?: string; reason?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; order_id?: string; return_date?: string; reason?: string | null; notes?: string | null; created_at?: string }
        Relationships: []
      }
      return_lines: {
        Row: { id: string; tenant_id: string; return_id: string; sku_id: string; qty: number; created_at: string }
        Insert: { id?: string; tenant_id: string; return_id: string; sku_id: string; qty: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; return_id?: string; sku_id?: string; qty?: number; created_at?: string }
        Relationships: []
      }
```

- [ ] **Step 2: Add function** — inside `Functions`, after the `create_order` block, add:
```ts
      create_return: {
        Args: { p_order_id: string; p_return_date?: string | null; p_reason: string; p_notes: string; p_lines: Json }
        Returns: string
      }
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`
Expected: No errors found.
```bash
git add src/types/database.ts
git commit -m "chore: hand-written types for returns"
```

---

## Task 4: Actions + Returns UI (dispatch to a subagent)

UI-heavy, fully specified. Verify with `npx tsc --noEmit` (NOT `npm run build`). Commit + push.

**Files:**
- Create: `src/lib/returns/actions.ts`, `src/app/(app)/returns/page.tsx`, `src/app/(app)/returns/new/page.tsx`, `src/app/(app)/returns/new/ReturnForm.tsx`, `src/app/(app)/returns/[id]/page.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Server action** — `src/lib/returns/actions.ts`
```ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type ReturnLineInput = { sku_id: string; qty: number }

export async function createReturn(input: {
  order_id: string; return_date: string; reason: string; notes: string; lines: ReturnLineInput[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_return', {
    p_order_id: input.order_id,
    p_return_date: input.return_date || null,
    p_reason: input.reason,
    p_notes: input.notes,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/returns/${data}`)
}
```

- [ ] **Step 2: Nav** — in `src/app/(app)/layout.tsx`, after the `<Link href="/channels">Channels</Link>` line add:
```tsx
        <Link href="/returns">Returns</Link>
```

- [ ] **Step 3: Returns list** — `src/app/(app)/returns/page.tsx`
```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function ReturnsPage() {
  const supabase = await createClient()
  const { data: returns } = await supabase
    .from('returns').select('id, code, return_date, order_id, reason')
    .order('return_date', { ascending: false })
  const { data: orders } = await supabase.from('orders').select('id, code')
  const orderCode = new Map((orders ?? []).map((o) => [o.id, o.code]))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Returns</h1>
        <Link href="/returns/new" className="vb-btn" style={{ textDecoration: 'none' }}>New return</Link>
      </div>
      {!returns?.length ? (
        <p style={{ color: 'var(--vb-muted)' }}>No returns yet.</p>
      ) : (
        <div className="vb-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Code</th><th style={{ padding: 12 }}>Order</th>
                <th style={{ padding: 12 }}>Date</th><th style={{ padding: 12 }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}><Link href={`/returns/${r.id}`} style={{ color: 'var(--vb-accent)' }}>{r.code}</Link></td>
                  <td style={{ padding: 12 }}>{orderCode.get(r.order_id) ?? '—'}</td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{r.return_date}</td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{r.reason ?? '—'}</td>
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

- [ ] **Step 4: New return** — `src/app/(app)/returns/new/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server'
import ReturnForm from './ReturnForm'

export default async function NewReturnPage() {
  const supabase = await createClient()
  const { data: orders } = await supabase.from('orders').select('id, code').order('order_date', { ascending: false })
  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>New return</h1>
      <ReturnForm orders={orders ?? []} skus={skus ?? []} />
    </div>
  )
}
```
`src/app/(app)/returns/new/ReturnForm.tsx`
```tsx
'use client'
import { useState } from 'react'
import { createReturn, type ReturnLineInput } from '@/lib/returns/actions'

type Opt = { id: string; code?: string; sku_code?: string }

export default function ReturnForm({ orders, skus }: { orders: Opt[]; skus: Opt[] }) {
  const [orderId, setOrderId] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku_id: string; qty: string }[]>([{ sku_id: '', qty: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!orderId) { setError('Pick an order'); return }
    const parsed: ReturnLineInput[] = []
    for (const l of lines) {
      if (!l.sku_id) continue
      const q = parseInt(l.qty, 10)
      if (!Number.isInteger(q) || q <= 0) { setError('Each line needs a positive qty'); return }
      parsed.push({ sku_id: l.sku_id, qty: q })
    }
    if (!parsed.length) { setError('Add at least one line'); return }
    setSaving(true)
    const res = await createReturn({ order_id: orderId, return_date: returnDate, reason, notes, lines: parsed })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      {error && <div style={{ color: '#ff9b9b' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <select className="vb-input" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">Select order…</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
        </select>
        <input className="vb-input" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
        <input className="vb-input" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="vb-input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Lines</div>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <select className="vb-input" value={l.sku_id} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, sku_id: e.target.value } : x))}>
              <option value="">Select SKU…</option>
              {skus.map((s) => <option key={s.id} value={s.id}>{s.sku_code}</option>)}
            </select>
            <input className="vb-input" placeholder="Qty" value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
            <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => [...p, { sku_id: '', qty: '' }])}>+ line</button>
      </div>
      <div><button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Create return (posts return_in)'}</button></div>
    </div>
  )
}
```

- [ ] **Step 5: Return detail** — `src/app/(app)/returns/[id]/page.tsx`
```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function ReturnDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: ret } = await supabase.from('returns').select('*').eq('id', id).single()
  if (!ret) notFound()

  const { data: order } = await supabase.from('orders').select('code').eq('id', ret.order_id).single()
  const { data: lines } = await supabase.from('return_lines').select('id, sku_id, qty').eq('return_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>{ret.code}</h1>
      <p style={{ color: 'var(--vb-muted)', marginBottom: 20 }}>Order {order?.code ?? '—'} · {ret.return_date}{ret.reason ? ` · ${ret.reason}` : ''}</p>

      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{codeOf.get(l.sku_id) ?? l.sku_id}</td>
                <td style={{ padding: 12 }}>{l.qty}</td>
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
git add src/lib/returns "src/app/(app)/returns" "src/app/(app)/layout.tsx"
git commit -m "feat: returns UI (create return posts return_in, detail)"
git push origin main
```

---

## Task 5: Playwright E2E

**Files:**
- Create: `e2e/returns.spec.ts`

- [ ] **Step 1: Write the E2E**

`e2e/returns.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('a return posts return_in and raises stock back', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.ret.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'RET E2E Co' },
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
    await page.fill('input[placeholder="Style code (VB-MIRA)"]', 'RET-E2E')
    await page.fill('input[placeholder="Name"]', 'RET Top')
    await page.fill('input[placeholder="Color name (Black)"]', 'Black')
    await page.fill('input[placeholder="Code (BLK)"]', 'BLK')
    await page.getByRole('button', { name: /Save style/ }).click()
    await expect(page.getByText('RET-E2E-BLK-S')).toBeVisible()

    // seed stock +100
    await page.goto('/stock')
    await page.selectOption('select', { label: 'RET-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty (e.g. 15 or -5)"]', '100')
    await page.fill('input[placeholder="Reason"]', 'seed')
    await page.getByRole('button', { name: 'Record adjustment' }).click()
    await expect(page.getByRole('cell', { name: '100', exact: true }).first()).toBeVisible()

    // channel + order 30 -> stock 70
    await page.goto('/channels')
    await page.fill('input[placeholder="Name (Shopee, Offline…)"]', 'Shopee RET')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByRole('cell', { name: 'Shopee RET' })).toBeVisible()
    await page.goto('/orders/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { label: 'RET-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '30')
    await page.getByRole('button', { name: /Create order/ }).click()
    await expect(page.getByText('RET-E2E-BLK-S')).toBeVisible()

    // return 10 -> stock 80
    await page.goto('/returns/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { label: 'RET-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '10')
    await page.getByRole('button', { name: /Create return/ }).click()
    await expect(page.getByText('RET-E2E-BLK-S')).toBeVisible()

    await page.goto('/stock')
    await expect(page.getByRole('cell', { name: '80', exact: true }).first()).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
```

- [ ] **Step 2: Run**

Run: `set -a && . ./.env.local && set +a && npm run e2e -- e2e/returns.spec.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit + push**

```bash
git add e2e/returns.spec.ts
git commit -m "test: return -> return_in -> stock E2E"
git push origin main
```

---

## Acceptance (whole sub-project)

- [ ] `npm run test:db supabase/tests/returns.test.sql` → `RESULT: PASS`.
- [ ] `npx tsc --noEmit` → No errors.
- [ ] `npm run e2e -- e2e/returns.spec.ts` → passes.
- [ ] Manual in preview: seed stock, make an order, make a return against it, stock rises by returned qty.
