# Vobia ERP Channel & Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record sales orders per channel that immediately post `sale_out` to the stock ledger per line.

**Architecture:** `channels`, `orders`, `order_lines` are tenant-scoped (RLS template). `create_order` is a `SECURITY INVOKER` RPC that stamps tenant, auto-codes the order, inserts lines, and calls `record_movement('sale_out')` per line (oversell allowed → negative balance). Mirror of Production's `production_in`. UI: `(app)/channels` + `(app)/orders/*` in the dark theme.

**Tech Stack:** Next.js 16, TypeScript, `@supabase/ssr`, Supabase Postgres (RLS + RPC), pgTAP, Playwright.

**Related spec:** `docs/superpowers/specs/2026-07-01-vobia-channel-order-design.md`

## Environment notes

- Export before DB steps: `export SUPABASE_DB_URL='postgresql://postgres.jchpnnrzcdicocbwtjac:<DB_PASSWORD>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres'`
- pgTAP: `npm run test:db <files>`. Types hand-written. Verify TS with `npx tsc --noEmit` (not `npm run build`). Playwright runs its own dev server on **port 3100** (config already set).

---

## File Structure

```
supabase/migrations/20260701000012_channel_order.sql   # channels, orders, order_lines + RLS + grants
supabase/migrations/20260701000013_order_fn.sql        # create_order RPC
supabase/tests/orders.test.sql
src/types/database.ts                                   # + 3 tables + create_order
src/lib/orders/actions.ts                              # createChannel, createOrder
src/app/(app)/channels/page.tsx + ChannelForm.tsx
src/app/(app)/orders/page.tsx
src/app/(app)/orders/new/page.tsx + OrderForm.tsx
src/app/(app)/orders/[id]/page.tsx
src/app/(app)/layout.tsx                               # + Orders/Channels nav
e2e/orders.spec.ts
```

---

## Task 1: Schema + RLS (TDD)

**Files:**
- Create: `supabase/migrations/20260701000012_channel_order.sql`, `supabase/tests/orders.test.sql`

- [ ] **Step 1: Write the failing isolation test**

`supabase/tests/orders.test.sql`:
```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a1010101-1010-1010-1010-101010101010','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ord_a@a.test','{"tenant_name":"ORD A"}'),
  ('b2020202-2020-2020-2020-202020202020','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ord_b@b.test','{"tenant_name":"ORD B"}');

insert into public.channels (tenant_id, name)
  values ((select tenant_id from public.profiles where id='b2020202-2020-2020-2020-202020202020'), 'B Channel');

select set_config('request.jwt.claims',
  json_build_object('sub','a1010101-1010-1010-1010-101010101010','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='a1010101-1010-1010-1010-101010101010'))::text, true);
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.channels;
  if n <> 0 then raise exception 'RLS FAIL: tenant A sees % channels from B', n; end if;
  raise notice 'ORD RLS OK: tenant A sees 0 of tenant B channels';
end $$;

rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db supabase/tests/orders.test.sql`
Expected: FAIL — `relation "public.channels" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260701000012_channel_order.sql`:
```sql
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  channel_id uuid not null references public.channels(id),
  order_date date not null default current_date,
  customer text,
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index orders_tenant_date_idx on public.orders(tenant_id, order_date desc);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  qty integer not null check (qty > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);
create index order_lines_order_id_idx on public.order_lines(order_id);

alter table public.channels enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;

create policy tenant_isolation on public.channels for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.orders for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.order_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.channels to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_lines to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/orders.test.sql`
Expected: `ORD RLS OK: tenant A sees 0 of tenant B channels`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000012_channel_order.sql supabase/tests/orders.test.sql
git commit -m "feat: channels/orders/order_lines schema + RLS"
```

---

## Task 2: create_order RPC (TDD)

**Files:**
- Create: `supabase/migrations/20260701000013_order_fn.sql`
- Modify: `supabase/tests/orders.test.sql`

- [ ] **Step 1: Append behavioral assertions**

Insert into `supabase/tests/orders.test.sql` immediately BEFORE the final `rollback;`:
```sql
do $$
declare
  v_tenant uuid := (current_setting('request.jwt.claims')::json->>'tenant_id')::uuid;
  v_channel uuid; v_style uuid; v_sku uuid; v_order uuid; v_bal int; v_lines int;
begin
  insert into public.channels (tenant_id, name) values (v_tenant, 'Shopee') returning id into v_channel;
  v_style := public.create_style_with_skus('ORD-STY','ORD Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  -- seed stock +100
  perform public.record_movement(v_sku, 100, 'production_in');

  -- order 30 -> sale_out -30 -> balance 70
  v_order := public.create_order(v_channel, current_date, 'Budi', '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 30, 'unit_price', 50000)));
  select count(*) into v_lines from public.order_lines where order_id = v_order;
  if v_lines <> 1 then raise exception 'expected 1 line, got %', v_lines; end if;
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 70 then raise exception 'expected balance 70, got %', v_bal; end if;

  -- oversell: order 100 -> balance -30 (allowed)
  perform public.create_order(v_channel, current_date, 'Ani', '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 100, 'unit_price', 50000)));
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> -30 then raise exception 'expected balance -30, got %', v_bal; end if;

  -- channel not in tenant -> raise
  begin
    perform public.create_order(gen_random_uuid(), current_date, '', '',
      jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1, 'unit_price', 0)));
    raise exception 'CH_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%channel not in tenant%' then raise; end if; end;

  raise notice 'orders OK: sale_out 70 -> -30 oversell, channel guard';
end $$;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db supabase/tests/orders.test.sql`
Expected: FAIL — `function public.create_order(...) does not exist`.

- [ ] **Step 3: Write the RPC migration**

`supabase/migrations/20260701000013_order_fn.sql`:
```sql
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
  v_code text := 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_order uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
  v_qty int;
  v_line_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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

grant execute on function public.create_order(uuid, date, text, text, jsonb) to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/orders.test.sql`
Expected: `ORD RLS OK...` and `orders OK: sale_out 70 -> -30 oversell, channel guard`, `RESULT: PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701000013_order_fn.sql supabase/tests/orders.test.sql
git commit -m "feat: create_order RPC (sale_out per line, oversell allowed)"
```

---

## Task 3: Extend hand-written types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add tables** — inside `Tables`, after the `cost_entries` block, add:
```ts
      channels: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      orders: {
        Row: { id: string; tenant_id: string; code: string; channel_id: string; order_date: string; customer: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; code: string; channel_id: string; order_date?: string; customer?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; channel_id?: string; order_date?: string; customer?: string | null; notes?: string | null; created_at?: string }
        Relationships: []
      }
      order_lines: {
        Row: { id: string; tenant_id: string; order_id: string; sku_id: string; qty: number; unit_price: number; created_at: string }
        Insert: { id?: string; tenant_id: string; order_id: string; sku_id: string; qty: number; unit_price?: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; order_id?: string; sku_id?: string; qty?: number; unit_price?: number; created_at?: string }
        Relationships: []
      }
```

- [ ] **Step 2: Add function** — inside `Functions`, after the `create_production_order` block, add:
```ts
      create_order: {
        Args: { p_channel_id: string; p_order_date?: string | null; p_customer: string; p_notes: string; p_lines: Json }
        Returns: string
      }
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`
Expected: No errors found.
```bash
git add src/types/database.ts
git commit -m "chore: hand-written types for channel & order"
```

---

## Task 4: Actions + Channel/Order UI (dispatch to a subagent)

UI-heavy, fully specified. Verify with `npx tsc --noEmit` (NOT `npm run build`). Commit + push.

**Files:**
- Create: `src/lib/orders/actions.ts`, `src/app/(app)/channels/page.tsx`, `src/app/(app)/channels/ChannelForm.tsx`, `src/app/(app)/orders/page.tsx`, `src/app/(app)/orders/new/page.tsx`, `src/app/(app)/orders/new/OrderForm.tsx`, `src/app/(app)/orders/[id]/page.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Server actions** — `src/lib/orders/actions.ts`
```ts
'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createChannel(input: { name: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('channels').insert({ name: input.name })
  if (error) return { error: error.message }
  revalidatePath('/channels')
}

export type OrderLineInput = { sku_id: string; qty: number; unit_price: number }

export async function createOrder(input: {
  channel_id: string; order_date: string; customer: string; notes: string; lines: OrderLineInput[]
}): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_order', {
    p_channel_id: input.channel_id,
    p_order_date: input.order_date || null,
    p_customer: input.customer,
    p_notes: input.notes,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/orders/${data}`)
}
```

- [ ] **Step 2: Nav** — in `src/app/(app)/layout.tsx`, after the `<Link href="/costing">Costing</Link>` line add:
```tsx
        <Link href="/orders">Orders</Link>
        <Link href="/channels">Channels</Link>
```

- [ ] **Step 3: Channels** — `src/app/(app)/channels/ChannelForm.tsx`
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createChannel } from '@/lib/orders/actions'

export default function ChannelForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    const res = await createChannel({ name: name.trim() })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    setName(''); router.refresh()
  }

  return (
    <div className="vb-card" style={{ padding: 16, maxWidth: 420, marginBottom: 24 }}>
      <div style={{ fontWeight: 500, marginBottom: 12 }}>New channel</div>
      {error && <div style={{ color: '#ff9b9b', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="vb-input" placeholder="Name (Shopee, Offline…)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Add'}</button>
      </div>
    </div>
  )
}
```
`src/app/(app)/channels/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server'
import ChannelForm from './ChannelForm'

export default async function ChannelsPage() {
  const supabase = await createClient()
  const { data: channels } = await supabase.from('channels').select('id, name, active').order('name')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>Channels</h1>
      <ChannelForm />
      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Name</th><th style={{ padding: 12 }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {!channels?.length ? (
              <tr><td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={2}>No channels yet.</td></tr>
            ) : channels.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12 }}>{c.name}</td>
                <td style={{ padding: 12 }}>{c.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Orders list** — `src/app/(app)/orders/page.tsx`
```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function OrdersPage() {
  const supabase = await createClient()
  const { data: orders } = await supabase
    .from('orders').select('id, code, order_date, channel_id')
    .order('order_date', { ascending: false })
  const { data: channels } = await supabase.from('channels').select('id, name')
  const { data: lines } = await supabase.from('order_lines').select('order_id, qty, unit_price')
  const channelName = new Map((channels ?? []).map((c) => [c.id, c.name]))
  const totalOf = new Map<string, number>()
  for (const l of lines ?? []) totalOf.set(l.order_id, (totalOf.get(l.order_id) ?? 0) + l.qty * Number(l.unit_price))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Orders</h1>
        <Link href="/orders/new" className="vb-btn" style={{ textDecoration: 'none' }}>New order</Link>
      </div>
      {!orders?.length ? (
        <p style={{ color: 'var(--vb-muted)' }}>No orders yet.</p>
      ) : (
        <div className="vb-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Code</th><th style={{ padding: 12 }}>Channel</th>
                <th style={{ padding: 12 }}>Date</th><th style={{ padding: 12 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}><Link href={`/orders/${o.id}`} style={{ color: 'var(--vb-accent)' }}>{o.code}</Link></td>
                  <td style={{ padding: 12 }}>{channelName.get(o.channel_id) ?? '—'}</td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{o.order_date}</td>
                  <td style={{ padding: 12 }}>{(totalOf.get(o.id) ?? 0).toLocaleString()}</td>
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

- [ ] **Step 5: New order** — `src/app/(app)/orders/new/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server'
import OrderForm from './OrderForm'

export default async function NewOrderPage() {
  const supabase = await createClient()
  const { data: channels } = await supabase.from('channels').select('id, name').order('name')
  const { data: skus } = await supabase.from('skus').select('id, sku_code').order('sku_code')
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>New order</h1>
      <OrderForm channels={channels ?? []} skus={skus ?? []} />
    </div>
  )
}
```
`src/app/(app)/orders/new/OrderForm.tsx`
```tsx
'use client'
import { useState } from 'react'
import { createOrder, type OrderLineInput } from '@/lib/orders/actions'

type Opt = { id: string; name?: string; sku_code?: string }

export default function OrderForm({ channels, skus }: { channels: Opt[]; skus: Opt[] }) {
  const [channelId, setChannelId] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [customer, setCustomer] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku_id: string; qty: string; price: string }[]>([{ sku_id: '', qty: '', price: '' }])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setError(null)
    if (!channelId) { setError('Pick a channel'); return }
    const parsed: OrderLineInput[] = []
    for (const l of lines) {
      if (!l.sku_id) continue
      const q = parseInt(l.qty, 10)
      if (!Number.isInteger(q) || q <= 0) { setError('Each line needs a positive qty'); return }
      parsed.push({ sku_id: l.sku_id, qty: q, unit_price: Number(l.price) || 0 })
    }
    if (!parsed.length) { setError('Add at least one line'); return }
    setSaving(true)
    const res = await createOrder({ channel_id: channelId, order_date: orderDate, customer, notes, lines: parsed })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      {error && <div style={{ color: '#ff9b9b' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <select className="vb-input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">Select channel…</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="vb-input" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        <input className="vb-input" placeholder="Customer (optional)" value={customer} onChange={(e) => setCustomer(e.target.value)} />
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
            <input className="vb-input" placeholder="Unit price" value={l.price} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
            <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="vb-btn-ghost" type="button" onClick={() => setLines((p) => [...p, { sku_id: '', qty: '', price: '' }])}>+ line</button>
      </div>
      <div><button className="vb-btn" type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Create order (posts sale_out)'}</button></div>
    </div>
  )
}
```

- [ ] **Step 6: Order detail** — `src/app/(app)/orders/[id]/page.tsx`
```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: order } = await supabase.from('orders').select('*').eq('id', id).single()
  if (!order) notFound()

  const { data: channel } = await supabase.from('channels').select('name').eq('id', order.channel_id).single()
  const { data: lines } = await supabase.from('order_lines').select('id, sku_id, qty, unit_price').eq('order_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))
  const total = (lines ?? []).reduce((s, l) => s + l.qty * Number(l.unit_price), 0)

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>{order.code}</h1>
      <p style={{ color: 'var(--vb-muted)', marginBottom: 20 }}>{channel?.name ?? '—'} · {order.order_date}{order.customer ? ` · ${order.customer}` : ''}</p>

      <div className="vb-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>SKU</th><th style={{ padding: 12 }}>Qty</th>
              <th style={{ padding: 12 }}>Unit price</th><th style={{ padding: 12 }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{codeOf.get(l.sku_id) ?? l.sku_id}</td>
                <td style={{ padding: 12 }}>{l.qty}</td>
                <td style={{ padding: 12 }}>{Number(l.unit_price).toLocaleString()}</td>
                <td style={{ padding: 12 }}>{(l.qty * Number(l.unit_price)).toLocaleString()}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid var(--vb-border)' }}>
              <td style={{ padding: 12, color: 'var(--vb-muted)' }} colSpan={3}>Total</td>
              <td style={{ padding: 12, fontWeight: 500 }}>{total.toLocaleString()}</td>
            </tr>
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
git add src/lib/orders "src/app/(app)/channels" "src/app/(app)/orders" "src/app/(app)/layout.tsx"
git commit -m "feat: channel & order UI (orders post sale_out, order detail)"
git push origin main
```

---

## Task 5: Playwright E2E

**Files:**
- Create: `e2e/orders.spec.ts`

- [ ] **Step 1: Write the E2E**

`e2e/orders.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('creating an order posts sale_out and lowers stock', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.ord.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'ORD E2E Co' },
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
    await page.fill('input[placeholder="Style code (VB-MIRA)"]', 'ORD-E2E')
    await page.fill('input[placeholder="Name"]', 'ORD Top')
    await page.fill('input[placeholder="Color name (Black)"]', 'Black')
    await page.fill('input[placeholder="Code (BLK)"]', 'BLK')
    await page.getByRole('button', { name: /Save style/ }).click()
    await expect(page.getByText('ORD-E2E-BLK-S')).toBeVisible()

    // seed stock +100 via adjustment
    await page.goto('/stock')
    await page.selectOption('select', { label: 'ORD-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty (e.g. 15 or -5)"]', '100')
    await page.fill('input[placeholder="Reason"]', 'seed')
    await page.getByRole('button', { name: 'Record adjustment' }).click()
    await expect(page.getByRole('cell', { name: '100', exact: true }).first()).toBeVisible()

    // channel
    await page.goto('/channels')
    await page.fill('input[placeholder="Name (Shopee, Offline…)"]', 'Shopee E2E')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByRole('cell', { name: 'Shopee E2E' })).toBeVisible()

    // order qty 30
    await page.goto('/orders/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { label: 'ORD-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '30')
    await page.fill('input[placeholder="Unit price"]', '50000')
    await page.getByRole('button', { name: /Create order/ }).click()
    await expect(page.getByText('ORD-E2E-BLK-S')).toBeVisible()

    // stock now 70
    await page.goto('/stock')
    await expect(page.getByRole('cell', { name: '70', exact: true }).first()).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
```

- [ ] **Step 2: Run**

Run: `set -a && . ./.env.local && set +a && npm run e2e -- e2e/orders.spec.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit + push**

```bash
git add e2e/orders.spec.ts
git commit -m "test: order -> sale_out -> stock E2E"
git push origin main
```

---

## Acceptance (whole sub-project)

- [ ] `npm run test:db supabase/tests/orders.test.sql` → `RESULT: PASS`.
- [ ] `npx tsc --noEmit` → No errors.
- [ ] `npm run e2e -- e2e/orders.spec.ts` → passes.
- [ ] Manual in preview: add channel, seed stock, create order, stock drops by ordered qty.
