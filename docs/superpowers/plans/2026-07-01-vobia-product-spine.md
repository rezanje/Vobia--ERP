# Vobia ERP Product Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the product catalog spine (`styles → colorways → skus`) with an atomic "create style + expand SKUs" flow and a dark-themed single-page UI.

**Architecture:** Three tenant-scoped tables under the same RLS template as Foundation. A `SECURITY INVOKER` Postgres RPC `create_style_with_skus` stamps `tenant_id` from the JWT claim and expands colorways × sizes into SKU rows in one transaction. Next.js App Router UI: a `(app)` route group with a nav shell, a styles list, a single-page create form with a live client-side SKU preview, and a style detail page — all in the salvaged Vobia dark theme.

**Tech Stack:** Next.js 16, TypeScript, Tailwind v4, `@supabase/ssr`, Supabase Postgres (RLS + plpgsql RPC), pgTAP, Vitest, Playwright.

**Related spec:** `docs/superpowers/specs/2026-07-01-vobia-product-spine-design.md`

## Environment notes (read once)

- **No Docker, no MCP access** to this project. Apply migrations with the Supabase CLI over the **session pooler** (direct connection is IPv6-only and times out). Before DB steps, export the pooler URI:
  ```bash
  export SUPABASE_DB_URL='postgresql://postgres.jchpnnrzcdicocbwtjac:<DB_PASSWORD>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres'
  ```
  (The password is in `.env.local` context / prior session; never commit it.)
- **pgTAP** runs via a committed node runner (`scripts/pgtap.mjs`, created in Task 1) — no `psql`, no local stack.
- **Types** are hand-written in `src/types/database.ts` (codegen needs Docker). Keep in sync.

---

## File Structure

```
scripts/pgtap.mjs                         # committed pgTAP runner (node pg)
supabase/migrations/
  20260701000005_product_spine.sql        # styles, colorways, skus, style_summary view, RLS, grants
  20260701000006_create_style_fn.sql      # create_style_with_skus RPC
supabase/tests/
  product_spine_rls.test.sql              # tenant isolation across the 3 tables
  create_style.test.sql                   # RPC expansion, override, rollback
src/types/database.ts                     # + styles/colorways/skus/style_summary/function
src/lib/products/
  skuCode.ts                              # pure helpers (buildSkuCode, resolveSkuCode)
  skuCode.test.ts                         # Vitest
  actions.ts                              # createStyle, toggleSku server actions
src/app/globals.css                       # + Vobia dark theme vars & .vb-* classes
src/app/(app)/layout.tsx                  # nav shell (Dashboard, Styles)
src/app/(app)/styles/page.tsx             # list (style_summary)
src/app/(app)/styles/new/page.tsx         # create form (client, live preview)
src/app/(app)/styles/[id]/page.tsx        # detail + sku active toggle
vitest.config.ts
e2e/product-spine.spec.ts                 # Playwright
```

---

## Task 1: pgTAP runner + Product Spine schema (TDD)

**Files:**
- Create: `scripts/pgtap.mjs`, `supabase/migrations/20260701000005_product_spine.sql`, `supabase/tests/product_spine_rls.test.sql`

- [ ] **Step 1: Commit a reusable pgTAP runner**

`scripts/pgtap.mjs`:
```js
import { Client } from 'pg'
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
c.on('notice', (n) => console.log(n.message))
await c.connect()
await c.query('create extension if not exists pgtap with schema extensions;')
let failed = false
for (const f of files) {
  console.log(`\n=== ${f} ===`)
  try {
    const res = await c.query(readFileSync(f, 'utf8'))
    for (const r of Array.isArray(res) ? res : [res]) {
      for (const row of r?.rows ?? []) {
        const v = Object.values(row).join(' ').trim()
        if (v) { console.log(v); if (/^not ok/i.test(v) || /^# Looks like you failed/i.test(v)) failed = true }
      }
    }
  } catch (e) { console.log('ERROR:', e.message); failed = true }
  await c.query('rollback').catch(() => {})
}
await c.end()
console.log('\n' + (failed ? 'RESULT: FAIL' : 'RESULT: PASS'))
process.exit(failed ? 1 : 0)
```

Add to `package.json` scripts: `"test:db": "node scripts/pgtap.mjs"`.

- [ ] **Step 2: Write the failing pgTAP isolation test**

`supabase/tests/product_spine_rls.test.sql`:
```sql
set search_path to public, auth;
begin;

-- two tenants via the signup trigger (auto tenant + owner profile)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ps_a@a.test','{"tenant_name":"PS A"}'),
  ('b2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ps_b@b.test','{"tenant_name":"PS B"}');

-- seed a style for tenant B directly (bypass RLS as postgres)
insert into public.styles (id, tenant_id, code, name)
  values ('c3333333-3333-3333-3333-333333333333',
          (select tenant_id from public.profiles where id='b2222222-2222-2222-2222-222222222222'),
          'B-CODE','B Style');

-- act as tenant A
select set_config('request.jwt.claims',
  json_build_object('sub','a1111111-1111-1111-1111-111111111111','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='a1111111-1111-1111-1111-111111111111'))::text, true);
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.styles;
  if n <> 0 then raise exception 'RLS FAIL: tenant A sees % styles from tenant B', n; end if;
  raise notice 'PS RLS OK: tenant A sees 0 of tenant B styles';
end $$;

rollback;
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:db supabase/tests/product_spine_rls.test.sql`
Expected: FAIL — `relation "public.styles" does not exist`.

- [ ] **Step 4: Write the migration**

`supabase/migrations/20260701000005_product_spine.sql`:
```sql
create table public.styles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  name text not null,
  collection text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.colorways (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  style_id uuid not null references public.styles(id) on delete cascade,
  color_name text not null,
  color_code text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, style_id, color_code)
);
create index colorways_style_id_idx on public.colorways(style_id);

create table public.skus (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  colorway_id uuid not null references public.colorways(id) on delete cascade,
  size text not null,
  sku_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, sku_code),
  unique (tenant_id, colorway_id, size)
);
create index skus_colorway_id_idx on public.skus(colorway_id);

-- RLS (same template as Foundation)
alter table public.styles enable row level security;
alter table public.colorways enable row level security;
alter table public.skus enable row level security;

create policy tenant_isolation on public.styles
  for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.colorways
  for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.skus
  for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.styles to authenticated;
grant select, insert, update, delete on public.colorways to authenticated;
grant select, insert, update, delete on public.skus to authenticated;

-- summary view for the list page; security_invoker so RLS of base tables applies
create view public.style_summary
  with (security_invoker = on) as
select s.*,
  (select count(*) from public.colorways c where c.style_id = s.id) as colorway_count,
  (select count(*) from public.skus k
     join public.colorways c on c.id = k.colorway_id
     where c.style_id = s.id) as sku_count
from public.styles s;

grant select on public.style_summary to authenticated;
```

- [ ] **Step 5: Apply the migration**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL"`
Expected: `Applying migration 20260701000005_product_spine.sql...` then `Finished supabase db push.` (a Docker cache warning is harmless).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:db supabase/tests/product_spine_rls.test.sql`
Expected: `PS RLS OK: tenant A sees 0 of tenant B styles` then `RESULT: PASS`.

- [ ] **Step 7: Commit**

```bash
git add scripts/pgtap.mjs package.json supabase/migrations/20260701000005_product_spine.sql supabase/tests/product_spine_rls.test.sql
git commit -m "feat: product spine schema (styles/colorways/skus) + RLS + summary view"
```

---

## Task 2: create_style_with_skus RPC (TDD)

**Files:**
- Create: `supabase/migrations/20260701000006_create_style_fn.sql`, `supabase/tests/create_style.test.sql`

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/create_style.test.sql`:
```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('d4444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','cs@c.test','{"tenant_name":"CS Co"}');

select set_config('request.jwt.claims',
  json_build_object('sub','d4444444-4444-4444-4444-444444444444','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='d4444444-4444-4444-4444-444444444444'))::text, true);
set local role authenticated;

do $$
declare
  v_style uuid;
  v_skus int;
  v_override text;
  my_tenant uuid := (current_setting('request.jwt.claims')::json->>'tenant_id')::uuid;
begin
  v_style := public.create_style_with_skus(
    'VB-MIRA','Mira Pleated Top','Daily Muse',
    '[{"color_name":"Black","color_code":"BLK"},{"color_name":"Cream","color_code":"CRM"}]'::jsonb,
    array['S','M','L'],
    '{"BLK-S":"CUSTOM-BLK-S"}'::jsonb
  );

  -- 2 colorways x 3 sizes = 6 skus, all stamped with my tenant
  select count(*) into v_skus from public.skus k
    join public.colorways c on c.id = k.colorway_id
    where c.style_id = v_style and k.tenant_id = my_tenant;
  if v_skus <> 6 then raise exception 'expected 6 skus, got %', v_skus; end if;

  -- auto code correct
  if not exists (select 1 from public.skus where sku_code = 'VB-MIRA-CRM-M') then
    raise exception 'auto sku_code VB-MIRA-CRM-M missing';
  end if;

  -- override applied
  select sku_code into v_override from public.skus where sku_code = 'CUSTOM-BLK-S';
  if v_override is null then raise exception 'override CUSTOM-BLK-S not applied'; end if;

  raise notice 'create_style OK: 6 skus, auto + override correct';
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db supabase/tests/create_style.test.sql`
Expected: FAIL — `function public.create_style_with_skus(...) does not exist`.

- [ ] **Step 3: Write the RPC migration**

`supabase/migrations/20260701000006_create_style_fn.sql`:
```sql
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

grant execute on function public.create_style_with_skus(text, text, text, jsonb, text[], jsonb) to authenticated;
```

- [ ] **Step 4: Apply + run**

Run: `npx supabase db push --db-url "$SUPABASE_DB_URL" && npm run test:db supabase/tests/create_style.test.sql`
Expected: `create_style OK: 6 skus, auto + override correct` then `RESULT: PASS`.

- [ ] **Step 5: Add a rollback assertion (duplicate sku_code)**

Append to `supabase/tests/create_style.test.sql` before `rollback;`:
```sql
do $$
declare before_ct int; after_ct int;
begin
  select count(*) into before_ct from public.styles;
  begin
    perform public.create_style_with_skus(
      'DUP','Dup','', '[{"color_name":"X","color_code":"X"}]'::jsonb,
      array['S','S'], '{}'::jsonb);   -- same colorway+size twice -> unique violation
    raise exception 'expected unique violation, none raised';
  exception when unique_violation then
    null;  -- expected
  end;
  select count(*) into after_ct from public.styles;
  if after_ct <> before_ct then raise exception 'partial style left after rollback'; end if;
  raise notice 'rollback OK: no orphan style on failure';
end $$;
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run test:db supabase/tests/create_style.test.sql`
Expected: both `create_style OK...` and `rollback OK...`, `RESULT: PASS`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260701000006_create_style_fn.sql supabase/tests/create_style.test.sql
git commit -m "feat: create_style_with_skus RPC (atomic colorway x size expansion)"
```

---

## Task 3: Extend hand-written database types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add the three tables + view + function to the `public` schema types**

In `src/types/database.ts`, inside `Tables`, after `profiles`, add:
```ts
      styles: {
        Row: { id: string; tenant_id: string; code: string; name: string; collection: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; code: string; name: string; collection?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; name?: string; collection?: string | null; created_at?: string }
        Relationships: []
      }
      colorways: {
        Row: { id: string; tenant_id: string; style_id: string; color_name: string; color_code: string; created_at: string }
        Insert: { id?: string; tenant_id: string; style_id: string; color_name: string; color_code: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; style_id?: string; color_name?: string; color_code?: string; created_at?: string }
        Relationships: []
      }
      skus: {
        Row: { id: string; tenant_id: string; colorway_id: string; size: string; sku_code: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; colorway_id: string; size: string; sku_code: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; colorway_id?: string; size?: string; sku_code?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
```

Replace the `Views` line with:
```ts
    Views: {
      style_summary: {
        Row: { id: string; tenant_id: string; code: string; name: string; collection: string | null; created_at: string; colorway_count: number; sku_count: number }
        Relationships: []
      }
    }
```

Replace the `Functions` line with:
```ts
    Functions: {
      create_style_with_skus: {
        Args: {
          p_code: string; p_name: string; p_collection: string
          p_colorways: Json; p_sizes: string[]; p_overrides: Json
        }
        Returns: string
      }
    }
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "chore: hand-written types for product spine tables/view/function"
```

---

## Task 4: SKU code helper (TDD, Vitest)

**Files:**
- Create: `vitest.config.ts`, `src/lib/products/skuCode.ts`, `src/lib/products/skuCode.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest + config**

Run: `npm i -D vitest`
Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
```
Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing test**

`src/lib/products/skuCode.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildSkuCode, overrideKey, resolveSkuCode } from './skuCode'

describe('skuCode', () => {
  it('builds auto code from parts', () => {
    expect(buildSkuCode('VB-MIRA', 'BLK', 'M')).toBe('VB-MIRA-BLK-M')
  })
  it('keys overrides by colorCode-size', () => {
    expect(overrideKey('BLK', 'S')).toBe('BLK-S')
  })
  it('uses override when present, else auto', () => {
    const ov = { 'BLK-S': 'CUSTOM' }
    expect(resolveSkuCode('VB-MIRA', 'BLK', 'S', ov)).toBe('CUSTOM')
    expect(resolveSkuCode('VB-MIRA', 'BLK', 'M', ov)).toBe('VB-MIRA-BLK-M')
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./skuCode`.

- [ ] **Step 4: Implement**

`src/lib/products/skuCode.ts`:
```ts
export function buildSkuCode(styleCode: string, colorCode: string, size: string): string {
  return `${styleCode}-${colorCode}-${size}`
}

export function overrideKey(colorCode: string, size: string): string {
  return `${colorCode}-${size}`
}

export function resolveSkuCode(
  styleCode: string,
  colorCode: string,
  size: string,
  overrides: Record<string, string>,
): string {
  return overrides[overrideKey(colorCode, size)] ?? buildSkuCode(styleCode, colorCode, size)
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/products/skuCode.ts src/lib/products/skuCode.test.ts
git commit -m "feat: sku code helpers + vitest"
```

---

## Task 5: Server actions

**Files:**
- Create: `src/lib/products/actions.ts`

- [ ] **Step 1: Implement the actions**

`src/lib/products/actions.ts`:
```ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type ColorwayInput = { color_name: string; color_code: string }

export type CreateStyleInput = {
  code: string
  name: string
  collection: string
  colorways: ColorwayInput[]
  sizes: string[]
  overrides: Record<string, string>
}

export async function createStyle(input: CreateStyleInput): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_style_with_skus', {
    p_code: input.code,
    p_name: input.name,
    p_collection: input.collection,
    p_colorways: input.colorways,
    p_sizes: input.sizes,
    p_overrides: input.overrides,
  })
  if (error) return { error: error.message }
  redirect(`/styles/${data}`)
}

export async function toggleSku(id: string, active: boolean): Promise<void> {
  const supabase = await createClient()
  await supabase.from('skus').update({ active }).eq('id', id)
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/products/actions.ts
git commit -m "feat: product spine server actions (createStyle, toggleSku)"
```

---

## Task 6: Vobia dark theme + `(app)` nav shell

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Append the Vobia theme to globals.css**

Append to `src/app/globals.css`:
```css
:root {
  --vb-bg: #0f1b15;
  --vb-surface: #16211b;
  --vb-border: #2b3a31;
  --vb-text: #e8f0e8;
  --vb-muted: #8fa89a;
  --vb-accent: #d7ff61;
}
.vb-app { min-height: 100vh; background: var(--vb-bg); color: var(--vb-text); display: flex; }
.vb-side { width: 200px; border-right: 1px solid var(--vb-border); padding: 20px 12px; display: flex; flex-direction: column; gap: 4px; }
.vb-side a { color: var(--vb-muted); text-decoration: none; padding: 8px 10px; border-radius: 8px; font-size: 14px; }
.vb-side a:hover { background: var(--vb-surface); color: var(--vb-text); }
.vb-main { flex: 1; padding: 28px 32px; }
.vb-card { background: var(--vb-surface); border: 1px solid var(--vb-border); border-radius: 12px; }
.vb-input { background: var(--vb-surface); border: 1px solid var(--vb-border); border-radius: 6px; padding: 8px 10px; color: var(--vb-text); width: 100%; }
.vb-btn { background: var(--vb-accent); color: #16211b; border: none; border-radius: 6px; padding: 8px 16px; font-weight: 500; cursor: pointer; }
.vb-btn-ghost { background: transparent; color: var(--vb-muted); border: 1px solid var(--vb-border); border-radius: 6px; padding: 8px 16px; cursor: pointer; }
.vb-chip { border: 1px solid var(--vb-border); color: var(--vb-muted); border-radius: 5px; padding: 4px 10px; cursor: pointer; user-select: none; }
.vb-chip.on { background: var(--vb-accent); color: #16211b; border-color: var(--vb-accent); font-weight: 500; }
```

- [ ] **Step 2: Create the nav shell**

`src/app/(app)/layout.tsx`:
```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="vb-app">
      <nav className="vb-side">
        <div style={{ color: 'var(--vb-accent)', fontWeight: 500, padding: '4px 10px 12px' }}>Vobia ERP</div>
        <Link href="/">Dashboard</Link>
        <Link href="/styles">Styles</Link>
      </nav>
      <main className="vb-main">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css "src/app/(app)/layout.tsx"
git commit -m "feat: vobia dark theme + app nav shell"
```

---

## Task 7: Styles list page

**Files:**
- Create: `src/app/(app)/styles/page.tsx`

- [ ] **Step 1: Implement the list**

`src/app/(app)/styles/page.tsx`:
```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function StylesPage() {
  const supabase = await createClient()
  const { data: styles } = await supabase
    .from('style_summary')
    .select('id, code, name, collection, colorway_count, sku_count')
    .order('created_at', { ascending: false })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Styles</h1>
        <Link href="/styles/new" className="vb-btn" style={{ textDecoration: 'none' }}>New style</Link>
      </div>

      {!styles?.length ? (
        <p style={{ color: 'var(--vb-muted)' }}>No styles yet. Create your first style.</p>
      ) : (
        <div className="vb-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Code</th><th style={{ padding: 12 }}>Name</th>
                <th style={{ padding: 12 }}>Collection</th><th style={{ padding: 12 }}>Colorways</th>
                <th style={{ padding: 12 }}>SKUs</th>
              </tr>
            </thead>
            <tbody>
              {styles.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}>
                    <Link href={`/styles/${s.id}`} style={{ color: 'var(--vb-accent)' }}>{s.code}</Link>
                  </td>
                  <td style={{ padding: 12 }}>{s.name}</td>
                  <td style={{ padding: 12, color: 'var(--vb-muted)' }}>{s.collection ?? '—'}</td>
                  <td style={{ padding: 12 }}>{s.colorway_count}</td>
                  <td style={{ padding: 12 }}>{s.sku_count}</td>
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

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/styles/page.tsx"
git commit -m "feat: styles list page"
```

---

## Task 8: Create-style form with live SKU preview

**Files:**
- Create: `src/app/(app)/styles/new/page.tsx`, `src/app/(app)/styles/new/StyleForm.tsx`

- [ ] **Step 1: Server page wrapper**

`src/app/(app)/styles/new/page.tsx`:
```tsx
import StyleForm from './StyleForm'

export default function NewStylePage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 20 }}>New style</h1>
      <StyleForm />
    </div>
  )
}
```

- [ ] **Step 2: Client form with live preview**

`src/app/(app)/styles/new/StyleForm.tsx`:
```tsx
'use client'
import { useMemo, useState } from 'react'
import { createStyle, type ColorwayInput } from '@/lib/products/actions'
import { resolveSkuCode, overrideKey } from '@/lib/products/skuCode'

const ALL_SIZES = ['S', 'M', 'L', 'XL']

export default function StyleForm() {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [collection, setCollection] = useState('')
  const [colorways, setColorways] = useState<ColorwayInput[]>([{ color_name: '', color_code: '' }])
  const [sizes, setSizes] = useState<string[]>(['S', 'M', 'L'])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const rows = useMemo(() => {
    const out: { key: string; color: string; size: string; codeVal: string }[] = []
    for (const cw of colorways) {
      if (!cw.color_code) continue
      for (const size of sizes) {
        const key = overrideKey(cw.color_code, size)
        out.push({ key, color: cw.color_name || cw.color_code, size, codeVal: resolveSkuCode(code, cw.color_code, size, overrides) })
      }
    }
    return out
  }, [colorways, sizes, code, overrides])

  function toggleSize(s: string) {
    setSizes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function onSave() {
    setError(null)
    setSaving(true)
    const res = await createStyle({ code, name, collection, colorways: colorways.filter((c) => c.color_code), sizes, overrides })
    if (res?.error) { setError(res.error); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      {error && <div style={{ color: '#ff9b9b' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <input className="vb-input" placeholder="Style code (VB-MIRA)" value={code} onChange={(e) => setCode(e.target.value)} />
        <input className="vb-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="vb-input" placeholder="Collection" value={collection} onChange={(e) => setCollection(e.target.value)} />
      </div>

      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Colorways</div>
        {colorways.map((cw, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input className="vb-input" placeholder="Color name (Black)" value={cw.color_name}
              onChange={(e) => setColorways((p) => p.map((c, j) => (j === i ? { ...c, color_name: e.target.value } : c)))} />
            <input className="vb-input" placeholder="Code (BLK)" value={cw.color_code}
              onChange={(e) => setColorways((p) => p.map((c, j) => (j === i ? { ...c, color_code: e.target.value } : c)))} />
            <button className="vb-btn-ghost" type="button" onClick={() => setColorways((p) => p.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="vb-btn-ghost" type="button" onClick={() => setColorways((p) => [...p, { color_name: '', color_code: '' }])}>+ colorway</button>
      </div>

      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Sizes</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {ALL_SIZES.map((s) => (
            <span key={s} className={`vb-chip ${sizes.includes(s) ? 'on' : ''}`} onClick={() => toggleSize(s)}>{s}</span>
          ))}
        </div>
      </div>

      <div>
        <div style={{ color: 'var(--vb-muted)', marginBottom: 6 }}>Preview — {rows.length} SKU (editable)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {rows.map((r) => (
            <input key={r.key} className="vb-input" value={r.codeVal}
              onChange={(e) => setOverrides((p) => ({ ...p, [r.key]: e.target.value }))} />
          ))}
        </div>
      </div>

      <div>
        <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : `Save style + ${rows.length} SKUs`}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/styles/new"
git commit -m "feat: single-page create-style form with live SKU preview"
```

---

## Task 9: Style detail page + SKU active toggle

**Files:**
- Create: `src/app/(app)/styles/[id]/page.tsx`, `src/app/(app)/styles/[id]/SkuToggle.tsx`

- [ ] **Step 1: SKU toggle client component**

`src/app/(app)/styles/[id]/SkuToggle.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { toggleSku } from '@/lib/products/actions'

export default function SkuToggle({ id, active }: { id: string; active: boolean }) {
  const [on, setOn] = useState(active)
  return (
    <span className={`vb-chip ${on ? 'on' : ''}`} onClick={async () => {
      const next = !on
      setOn(next)
      await toggleSku(id, next)
    }}>{on ? 'active' : 'inactive'}</span>
  )
}
```

- [ ] **Step 2: Detail page**

`src/app/(app)/styles/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SkuToggle from './SkuToggle'

export default async function StyleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: style } = await supabase.from('styles').select('*').eq('id', id).single()
  if (!style) notFound()

  const { data: colorways } = await supabase
    .from('colorways').select('id, color_name, color_code').eq('style_id', id)
  const cwIds = (colorways ?? []).map((c) => c.id)
  const { data: skus } = await supabase
    .from('skus').select('id, colorway_id, size, sku_code, active').in('colorway_id', cwIds.length ? cwIds : ['00000000-0000-0000-0000-000000000000'])

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>{style.name}</h1>
      <p style={{ color: 'var(--vb-muted)', marginBottom: 20 }}>{style.code}{style.collection ? ` · ${style.collection}` : ''}</p>

      <div className="vb-card" style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--vb-muted)', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Colorway</th><th style={{ padding: 12 }}>Size</th>
              <th style={{ padding: 12 }}>SKU code</th><th style={{ padding: 12 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(skus ?? []).map((k) => {
              const cw = colorways?.find((c) => c.id === k.colorway_id)
              return (
                <tr key={k.id} style={{ borderTop: '1px solid var(--vb-border)' }}>
                  <td style={{ padding: 12 }}>{cw?.color_name ?? '—'}</td>
                  <td style={{ padding: 12 }}>{k.size}</td>
                  <td style={{ padding: 12, color: 'var(--vb-accent)' }}>{k.sku_code}</td>
                  <td style={{ padding: 12 }}><SkuToggle id={k.id} active={k.active} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/styles/[id]"
git commit -m "feat: style detail page with SKU active toggle"
```

---

## Task 10: Playwright E2E

**Files:**
- Create: `e2e/product-spine.spec.ts`

- [ ] **Step 1: Write the E2E**

`e2e/product-spine.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('create a style expands to SKUs and shows them on detail', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.ps.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'PS E2E Co' },
  })
  expect(error).toBeNull()
  const userId = created!.user.id

  try {
    await page.goto('/login')
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')
    await expect(page.getByText('Vobia ERP')).toBeVisible()

    await page.goto('/styles/new')
    await page.fill('input[placeholder="Style code (VB-MIRA)"]', 'VB-E2E')
    await page.fill('input[placeholder="Name"]', 'E2E Top')
    await page.fill('input[placeholder="Color name (Black)"]', 'Black')
    await page.fill('input[placeholder="Code (BLK)"]', 'BLK')
    // sizes S, M, L are on by default → 3 SKUs
    await page.getByRole('button', { name: /Save style/ }).click()

    // redirected to detail; the 3 auto SKUs are visible
    await expect(page.getByText('VB-E2E-BLK-S')).toBeVisible()
    await expect(page.getByText('VB-E2E-BLK-M')).toBeVisible()
    await expect(page.getByText('VB-E2E-BLK-L')).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
```

- [ ] **Step 2: Run it**

Run (with env loaded): `set -a && . ./.env.local && set +a && npm run e2e -- e2e/product-spine.spec.ts`
Expected: 1 passed. (Requires the auth hook enabled + email confirmation disabled — already done in Foundation.)

- [ ] **Step 3: Commit + push**

```bash
git add e2e/product-spine.spec.ts
git commit -m "test: product spine create→expand→detail E2E"
git push origin main
```

---

## Acceptance (whole sub-project)

- [ ] `npm run test:db supabase/tests/product_spine_rls.test.sql supabase/tests/create_style.test.sql` → `RESULT: PASS`.
- [ ] `npm test` → skuCode 3 passed.
- [ ] `npm run e2e -- e2e/product-spine.spec.ts` → create→expand→detail passes.
- [ ] `npm run build` succeeds.
- [ ] Manual: two tenants each create a style; neither sees the other's in `/styles`.
