# Langkah 1 — Surat SPK + PO (Draft → ACC → Cetak) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draft→approved document layer to production orders and material POs, gate downstream actions on approval, and render printable SPK/PO letters.

**Architecture:** Two new columns (`doc_status`, `approved_by`, `approved_at`) on `production_orders` and `purchase_orders`. A `security definer` RPC `approve_document` enforces role (`owner`/`ops`) and tenant. Existing writer RPCs (`issue_material_to_po`, `receive_purchase`) reject non-approved docs. Next.js server-component pages render print-friendly letters; user prints via browser.

**Tech Stack:** Supabase Postgres (migrations via `supabase db push` over the pooler), pgTAP (`npm run test:db`), Next.js 16 App Router server components + Server Actions, Playwright.

**Conventions (verified in repo):**
- App role lives in the JWT `user_role` claim (NOT reserved `role`) — see auth hook `20260701000004_fix_hook_role_claim.sql`.
- Tenant via `auth.jwt() ->> 'tenant_id'`. RLS `tenant_isolation` already covers new columns.
- Types are hand-written in `src/types/database.ts` (no Docker codegen).
- Migrations run against the remote DB; pgTAP tests run against the same DB via `SUPABASE_DB_URL`.

---

### Task 1: Schema — document approval columns

**Files:**
- Create: `supabase/migrations/20260713000001_doc_approval.sql`
- Modify: `src/types/database.ts` (production_orders + purchase_orders Row/Insert/Update)

- [ ] **Step 1: Write the migration**

```sql
-- Draft→approved document layer for production orders and material POs.
-- Orthogonal to production_orders.stage and purchase_orders.status.
alter table public.production_orders
  add column doc_status text not null default 'draft'
    check (doc_status in ('draft','approved')),
  add column approved_by uuid references auth.users(id),
  add column approved_at timestamptz;

alter table public.purchase_orders
  add column doc_status text not null default 'draft'
    check (doc_status in ('draft','approved')),
  add column approved_by uuid references auth.users(id),
  add column approved_at timestamptz;

-- Backfill existing rows (seed/simulation) as approved so already-issued /
-- already-received orders stay valid under the new gate.
update public.production_orders set doc_status = 'approved', approved_at = created_at
  where doc_status = 'draft';
update public.purchase_orders set doc_status = 'approved', approved_at = created_at
  where doc_status = 'draft';
```

- [ ] **Step 2: Apply**

Run: `supabase db push`
Expected: migration applied, no error.

- [ ] **Step 3: Verify columns exist**

Run: `SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)" node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL});await c.connect();const r=await c.query(\"select column_name from information_schema.columns where table_name='production_orders' and column_name='doc_status'\");console.log(r.rowCount);await c.end()})()"`
Expected: prints `1`.

- [ ] **Step 4: Update hand-written types**

In `src/types/database.ts`, add to the `production_orders` and `purchase_orders` table definitions:
- `Row`: `doc_status: string; approved_by: string | null; approved_at: string | null`
- `Insert`: `doc_status?: string; approved_by?: string | null; approved_at?: string | null`
- `Update`: `doc_status?: string; approved_by?: string | null; approved_at?: string | null`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713000001_doc_approval.sql src/types/database.ts
git commit -m "feat: doc_status/approved_by/approved_at on production+purchase orders"
```

---

### Task 2: `approve_document` RPC + role guard

**Files:**
- Create: `supabase/migrations/20260713000002_approve_document.sql`
- Test: `supabase/tests/doc_approval.test.sql`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('d1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','doc-owner@s.test','{"tenant_name":"Doc Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='d1111111-1111-1111-1111-111111111111');
  v_style uuid; v_vendor uuid; v_po uuid;
begin
  -- owner claims
  perform set_config('request.jwt.claims',
    json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated',
      'user_role','owner','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.styles (tenant_id, code, name) values (v_tenant,'S1','Style') returning id into v_style;
  insert into public.vendors (tenant_id, name) values (v_tenant,'V1') returning id into v_vendor;
  insert into public.production_orders (tenant_id, code, style_id, vendor_id)
    values (v_tenant,'PO-DRAFT', v_style, v_vendor) returning id into v_po;

  -- default is draft
  if (select doc_status from public.production_orders where id=v_po) <> 'draft' then
    raise exception 'FAIL: new order should be draft'; end if;

  -- owner can approve
  perform public.approve_document('production', v_po);
  if (select doc_status from public.production_orders where id=v_po) <> 'approved' then
    raise exception 'FAIL: owner approve did not stick'; end if;

  -- viewer cannot approve
  insert into public.production_orders (tenant_id, code, style_id, vendor_id)
    values (v_tenant,'PO-DRAFT2', v_style, v_vendor) returning id into v_po;
  perform set_config('request.jwt.claims',
    json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated',
      'user_role','viewer','tenant_id',v_tenant::text)::text, true);
  begin
    perform public.approve_document('production', v_po);
    raise exception 'FAIL: viewer should not approve';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;  -- re-raise our own assertion
  end;

  raise notice 'OK doc_approval';
end $$;

rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — `function public.approve_document(unknown, uuid) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
create or replace function public.approve_document(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role   text := auth.jwt() ->> 'user_role';
  v_hit    uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_kind not in ('production','purchase') then raise exception 'invalid kind: %', p_kind; end if;
  if coalesce(v_role,'') not in ('owner','ops') then raise exception 'not authorized to approve'; end if;

  if p_kind = 'production' then
    update public.production_orders
      set doc_status='approved', approved_by=auth.uid(), approved_at=now()
      where id=p_id and tenant_id=v_tenant and doc_status='draft'
      returning id into v_hit;
    if v_hit is null and not exists
       (select 1 from public.production_orders where id=p_id and tenant_id=v_tenant) then
      raise exception 'production order not found';
    end if;  -- v_hit null + row exists = already approved → idempotent no-op
  else
    update public.purchase_orders
      set doc_status='approved', approved_by=auth.uid(), approved_at=now()
      where id=p_id and tenant_id=v_tenant and doc_status='draft'
      returning id into v_hit;
    if v_hit is null and not exists
       (select 1 from public.purchase_orders where id=p_id and tenant_id=v_tenant) then
      raise exception 'purchase order not found';
    end if;
  end if;
end;
$$;

grant execute on function public.approve_document(text, uuid) to authenticated;
```

- [ ] **Step 4: Apply + run test to verify it passes**

Run: `supabase db push && npm run test:db`
Expected: PASS — `OK doc_approval`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713000002_approve_document.sql supabase/tests/doc_approval.test.sql
git commit -m "feat: approve_document RPC with owner/ops role guard"
```

---

### Task 3: Gate downstream writers on approval

**Files:**
- Create: `supabase/migrations/20260713000003_gate_on_approval.sql`
- Test: `supabase/tests/doc_approval.test.sql` (append cases)

- [ ] **Step 1: Append failing gate assertions to the test**

Insert before `raise notice 'OK doc_approval';` in the `do $$` block:

```sql
  -- gate: issuing material to a DRAFT production order must fail
  declare v_mat uuid; v_draftpo uuid;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated',
        'user_role','owner','tenant_id',v_tenant::text)::text, true);
    insert into public.materials (tenant_id, code, name, category, uom)
      values (v_tenant,'M-G','Kain','fabric','m') returning id into v_mat;
    insert into public.production_orders (tenant_id, code, style_id, vendor_id)
      values (v_tenant,'PO-GATE', v_style, v_vendor) returning id into v_draftpo;
    begin
      perform public.issue_material_to_po(v_draftpo,
        jsonb_build_array(jsonb_build_object('material_id',v_mat::text,'qty',1)), null);
      raise exception 'FAIL: issue on draft should be blocked';
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
    end;
  end;
```

- [ ] **Step 2: Run test to verify new assertion fails**

Run: `npm run test:db`
Expected: FAIL — `FAIL: issue on draft should be blocked` (issue currently succeeds on drafts).

- [ ] **Step 3: Write the migration (re-create both writers with the guard)**

```sql
-- Re-declare issue_material_to_po with an approval guard. Body identical to
-- 20260710000006 except the doc_status check after resolving the order.
create or replace function public.issue_material_to_po(
  p_prod_po_id uuid, p_issues jsonb, p_location_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text; v_ds text; v_loc uuid; v_iss jsonb; v_mat uuid; v_qty numeric; v_bal numeric;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select code, doc_status into v_code, v_ds from public.production_orders
    where id = p_prod_po_id and tenant_id = v_tenant;
  if v_code is null then raise exception 'production order not found'; end if;
  if v_ds <> 'approved' then raise exception 'production order belum di-ACC'; end if;

  if p_location_id is null then
    select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
    if v_loc is null then raise exception 'no default location'; end if;
  else
    if not exists (select 1 from public.locations where id = p_location_id and tenant_id = v_tenant) then
      raise exception 'location not in tenant';
    end if;
    v_loc := p_location_id;
  end if;
  if p_issues is null or jsonb_array_length(p_issues) < 1 then raise exception 'no issues'; end if;

  for v_iss in select value from jsonb_array_elements(p_issues) loop
    v_mat := (v_iss ->> 'material_id')::uuid;
    v_qty := (v_iss ->> 'qty')::numeric;
    if v_qty <= 0 then raise exception 'issue qty must be > 0'; end if;
    if not exists (select 1 from public.materials where id = v_mat and tenant_id = v_tenant) then
      raise exception 'material not in tenant';
    end if;
    select coalesce(sum(qty), 0) into v_bal from public.material_ledger
      where material_id = v_mat and location_id = v_loc;
    if v_bal < v_qty then raise exception 'insufficient material balance: have %, need %', v_bal, v_qty; end if;
    perform public.record_material_movement(v_mat, v_qty, 'issue_out', 'issue to ' || v_code, 'production_order', p_prod_po_id, v_loc);
  end loop;
end;
$$;
grant execute on function public.issue_material_to_po(uuid, jsonb, uuid) to authenticated;

-- Re-declare receive_purchase with an approval guard. Body identical to
-- 20260710000004 except doc_status is fetched and checked.
create or replace function public.receive_purchase(p_po_id uuid, p_receipts jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_status text; v_ds text; v_loc uuid; v_rec jsonb; v_line public.purchase_lines; v_qty numeric; v_all_full boolean;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select status, doc_status, location_id into v_status, v_ds, v_loc from public.purchase_orders
    where id = p_po_id and tenant_id = v_tenant;
  if v_status is null then raise exception 'purchase order not found'; end if;
  if v_ds <> 'approved' then raise exception 'purchase order belum di-ACC'; end if;
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
grant execute on function public.receive_purchase(uuid, jsonb) to authenticated;
```

- [ ] **Step 4: Apply + run test to verify pass**

Run: `supabase db push && npm run test:db`
Expected: PASS — `OK doc_approval`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713000003_gate_on_approval.sql supabase/tests/doc_approval.test.sql
git commit -m "feat: block material issue + PO receive until document approved"
```

---

### Task 4: Role helper + approveDocument server action

**Files:**
- Create: `src/lib/auth/role.ts`
- Create: `src/lib/documents/actions.ts`

- [ ] **Step 1: Write the role helper**

```ts
import { createClient } from '@/lib/supabase/server'

// Current user's app role from their profile (owner/ops/production/inventory/finance/viewer).
export async function getRole(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return data?.role ?? null
}

export const canApprove = (role: string | null) => role === 'owner' || role === 'ops'
```

- [ ] **Step 2: Write the server action**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// DB enforces role (owner/ops) + tenant; UI hides the button. This stays thin.
export async function approveDocument(input: { kind: 'production' | 'purchase'; id: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('approve_document', { p_kind: input.kind, p_id: input.id })
  if (error) return { error: error.message }
  const base = input.kind === 'production' ? '/production' : '/purchasing'
  revalidatePath(`${base}/${input.id}`)
  revalidatePath(base)
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/role.ts src/lib/documents/actions.ts
git commit -m "feat: getRole helper + approveDocument action"
```

---

### Task 5: Approve button + status badge (shared client component)

**Files:**
- Create: `src/components/DocApproval.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { approveDocument } from '@/lib/documents/actions'

export function DocBadge({ approved }: { approved: boolean }) {
  return (
    <span className="vb-badge" style={{ background: approved ? 'var(--vb-accent)' : 'var(--vb-border)', color: approved ? '#1a1a1a' : 'var(--vb-muted)', padding: '2px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 600 }}>
      {approved ? 'Resmi' : 'Draft'}
    </span>
  )
}

export function DocActions(props: {
  kind: 'production' | 'purchase'; id: string; approved: boolean; canApprove: boolean; suratHref: string
}) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  if (props.approved) {
    return <Link href={props.suratHref} className="vb-btn">Cetak Surat</Link>
  }
  if (!props.canApprove) {
    return <span className="vb-muted" style={{ fontSize: 12 }}>Menunggu ACC dari owner/ops.</span>
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <button className="vb-btn" disabled={pending} onClick={() => start(async () => {
        const r = await approveDocument({ kind: props.kind, id: props.id })
        if (r?.error) setErr(r.error)
      })}>{pending ? 'Memproses…' : 'ACC'}</button>
      {err && <span style={{ color: 'var(--vb-danger, #e66)', fontSize: 12 }}>{err}</span>}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `vb-btn`/`vb-badge` classes are absent, reuse the button styling already used by `+ Order Produksi`; check `src/app/globals.css` and match an existing class.)

- [ ] **Step 3: Commit**

```bash
git add src/components/DocApproval.tsx
git commit -m "feat: DocBadge + DocActions (ACC / cetak) client component"
```

---

### Task 6: Wire approval into production + purchasing detail pages

**Files:**
- Modify: `src/app/(app)/production/[id]/page.tsx`
- Modify: `src/app/(app)/purchasing/[id]/page.tsx`
- Modify: `src/app/(app)/production/[id]/IssueSection.tsx` (disable when draft)
- Modify: `src/app/(app)/purchasing/[id]/ReceiveForm.tsx` (disable when draft)

- [ ] **Step 1: Production detail — header badge + actions + gate**

In `production/[id]/page.tsx`, add imports:
```tsx
import { DocBadge, DocActions } from '@/components/DocApproval'
import { getRole, canApprove } from '@/lib/auth/role'
```
After `if (!po) notFound()`, add: `const role = await getRole()`.
Replace the header block so the title row shows the badge + actions:
```tsx
<div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
  <div>
    <h1 className="vb-h1">{po.code} <DocBadge approved={po.doc_status === 'approved'} /></h1>
    <div className="vb-sub">{po.deadline ? `Deadline ${po.deadline}` : 'Tanpa deadline'}{po.notes ? ` · ${po.notes}` : ''}</div>
  </div>
  <DocActions kind="production" id={po.id} approved={po.doc_status === 'approved'} canApprove={canApprove(role)} suratHref={`/production/${po.id}/surat`} />
</div>
```
Change the `IssueSection` render to pass the gate: `<IssueSection prodPoId={po.id} suggestions={suggestions} locations={issueLocations ?? []} disabled={po.doc_status !== 'approved'} />`.

- [ ] **Step 2: IssueSection — respect `disabled`**

In `IssueSection.tsx`, add `disabled?: boolean` to its props. When `disabled`, render a hint instead of the form body: `if (disabled) return <div className="vb-card" style={{ padding: '16px', color: 'var(--vb-dim)', fontSize: 12.5 }}>ACC order dulu sebelum keluarin bahan.</div>` (place after the existing card title if the component has one; otherwise at the top of the returned JSX).

- [ ] **Step 3: Purchasing detail — badge + actions + gate**

Open `purchasing/[id]/page.tsx`. Mirror Step 1: import `DocBadge`, `DocActions`, `getRole`, `canApprove`; fetch `const role = await getRole()`; add `<DocBadge approved={po.doc_status === 'approved'} />` to the header title and `<DocActions kind="purchase" id={po.id} approved={po.doc_status === 'approved'} canApprove={canApprove(role)} suratHref={`/purchasing/${po.id}/surat`} />` in the header row. Pass `disabled={po.doc_status !== 'approved'}` into `ReceiveForm`.

- [ ] **Step 4: ReceiveForm — respect `disabled`**

In `ReceiveForm.tsx`, add `disabled?: boolean` to props; when `disabled`, return a hint `<div className="vb-card" style={{ padding: 16, color: 'var(--vb-dim)', fontSize: 12.5 }}>ACC PO dulu sebelum terima barang.</div>` instead of the receive form.

- [ ] **Step 5: Verify in browser**

Start preview (`preview_start` name `dev`), sign in as `superadmin@vobia.com` / `password123` (owner). New orders will be `draft` going forward; existing seed orders are `approved`. Create a new production order → detail shows `Draft` badge + `ACC` button; issue section shows the hint. Click `ACC` → badge flips to `Resmi`, `Cetak Surat` appears, issue section enabled. Check `read_console_messages` for errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/production/[id]/page.tsx" "src/app/(app)/production/[id]/IssueSection.tsx" "src/app/(app)/purchasing/[id]/page.tsx" "src/app/(app)/purchasing/[id]/ReceiveForm.tsx"
git commit -m "feat: ACC + gate on production and purchasing detail pages"
```

---

### Task 7: Printable letter pages (SPK + PO)

**Files:**
- Create: `src/components/PrintButton.tsx`
- Create: `src/app/(app)/production/[id]/surat/page.tsx`
- Create: `src/app/(app)/purchasing/[id]/surat/page.tsx`
- Modify: `src/app/globals.css` (append print rules)

- [ ] **Step 1: PrintButton (client)**

```tsx
'use client'
export default function PrintButton() {
  return <button className="vb-btn no-print" onClick={() => window.print()}>Cetak / Simpan PDF</button>
}
```

- [ ] **Step 2: Print CSS**

Append to `src/app/globals.css`:
```css
.surat { max-width: 720px; margin: 0 auto; background: #fff; color: #1a1a1a; padding: 40px 44px; font-family: Georgia, 'Times New Roman', serif; }
.surat table { width: 100%; border-collapse: collapse; }
.surat th, .surat td { border: 1px solid #ddd; padding: 8px 10px; font-family: Arial, sans-serif; font-size: 12.5px; }
@media print { .no-print { display: none !important; } .vb-side { display: none !important; } body { background: #fff; } }
@page { margin: 16mm; }
```

- [ ] **Step 3: SPK page**

```tsx
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PrintButton from '@/components/PrintButton'

export default async function SuratSPK({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: po } = await supabase.from('production_orders').select('*').eq('id', id).single()
  if (!po) notFound()
  if (po.doc_status !== 'approved') redirect(`/production/${id}`)

  const { data: style } = await supabase.from('styles').select('name').eq('id', po.style_id).single()
  const { data: vendor } = await supabase.from('vendors').select('name, contact').eq('id', po.vendor_id).single()
  const { data: lines } = await supabase.from('prod_lines').select('sku_id, qty_ordered').eq('po_id', id)
  const skuIds = (lines ?? []).map((l) => l.sku_id)
  const { data: skus } = await supabase.from('skus').select('id, sku_code').in('id', skuIds.length ? skuIds : ['00000000-0000-0000-0000-000000000000'])
  const codeOf = new Map((skus ?? []).map((s) => [s.id, s.sku_code]))
  const total = (lines ?? []).reduce((s, l) => s + Number(l.qty_ordered), 0)

  return (
    <div>
      <div className="no-print" style={{ maxWidth: 720, margin: '0 auto 12px' }}><PrintButton /></div>
      <div className="surat">
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #1a1a1a', paddingBottom: 12 }}>
          <div><div style={{ fontFamily: 'Arial', fontSize: 22, fontWeight: 700 }}>VOBIA</div><div style={{ fontFamily: 'Arial', fontSize: 11, color: '#666' }}>Fashion Commerce · Jakarta</div></div>
          <div style={{ textAlign: 'right', fontFamily: 'Arial' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>SURAT PERINTAH KERJA</div>
            <div style={{ fontSize: 12, color: '#444' }}>No. {po.code}</div>
            <div style={{ fontSize: 12, color: '#444' }}>Tanggal: {new Date(po.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 32, marginTop: 16, fontFamily: 'Arial', fontSize: 12.5 }}>
          <div style={{ flex: 1 }}><div style={{ color: '#888', fontSize: 11 }}>KEPADA (KONVEKSI)</div><div style={{ fontWeight: 700 }}>{vendor?.name}</div><div style={{ color: '#555' }}>{vendor?.contact ?? ''}</div></div>
          <div style={{ flex: 1 }}><div style={{ color: '#888', fontSize: 11 }}>DEADLINE</div><div style={{ fontWeight: 700 }}>{po.deadline ?? '—'}</div><div style={{ color: '#555' }}>Style: {style?.name}</div></div>
        </div>
        <table style={{ marginTop: 18 }}>
          <thead><tr style={{ background: '#f4f4f4' }}><th style={{ textAlign: 'left' }}>Kode SKU</th><th style={{ textAlign: 'right' }}>Jumlah</th></tr></thead>
          <tbody>
            {(lines ?? []).map((l, i) => (<tr key={i}><td>{codeOf.get(l.sku_id) ?? l.sku_id}</td><td style={{ textAlign: 'right' }}>{l.qty_ordered}</td></tr>))}
            <tr style={{ fontWeight: 700, background: '#fafafa' }}><td>Total unit</td><td style={{ textAlign: 'right' }}>{total}</td></tr>
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 40, fontFamily: 'Arial', fontSize: 12.5, textAlign: 'center' }}>
          <div><div style={{ color: '#555' }}>Disetujui (ACC),</div><div style={{ height: 52 }} /><div style={{ fontWeight: 700, borderTop: '1px solid #999', paddingTop: 4, minWidth: 180 }}>{po.approved_at ? new Date(po.approved_at).toLocaleDateString('id-ID') : ''}</div></div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: PO page**

Create `purchasing/[id]/surat/page.tsx` with the same structure, titled `PURCHASE ORDER`, "KEPADA (SUPPLIER)", and a line table with columns Bahan / Jumlah / Harga / Subtotal:
```tsx
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PrintButton from '@/components/PrintButton'
import { rp } from '@/lib/ui'

export default async function SuratPO({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: po } = await supabase.from('purchase_orders').select('*').eq('id', id).single()
  if (!po) notFound()
  if (po.doc_status !== 'approved') redirect(`/purchasing/${id}`)
  const { data: vendor } = await supabase.from('vendors').select('name, contact').eq('id', po.vendor_id).single()
  const { data: lines } = await supabase.from('purchase_lines').select('material_id, qty_ordered, unit_price').eq('po_id', id)
  const matIds = (lines ?? []).map((l) => l.material_id)
  const { data: mats } = await supabase.from('materials').select('id, code, name').in('id', matIds.length ? matIds : ['00000000-0000-0000-0000-000000000000'])
  const matOf = new Map((mats ?? []).map((m) => [m.id, m]))
  const grand = (lines ?? []).reduce((s, l) => s + Number(l.qty_ordered) * Number(l.unit_price), 0)
  return (
    <div>
      <div className="no-print" style={{ maxWidth: 720, margin: '0 auto 12px' }}><PrintButton /></div>
      <div className="surat">
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #1a1a1a', paddingBottom: 12 }}>
          <div><div style={{ fontFamily: 'Arial', fontSize: 22, fontWeight: 700 }}>VOBIA</div><div style={{ fontFamily: 'Arial', fontSize: 11, color: '#666' }}>Fashion Commerce · Jakarta</div></div>
          <div style={{ textAlign: 'right', fontFamily: 'Arial' }}><div style={{ fontSize: 15, fontWeight: 700 }}>PURCHASE ORDER</div><div style={{ fontSize: 12, color: '#444' }}>No. {po.code}</div><div style={{ fontSize: 12, color: '#444' }}>Tanggal: {po.order_date}</div></div>
        </div>
        <div style={{ marginTop: 16, fontFamily: 'Arial', fontSize: 12.5 }}><div style={{ color: '#888', fontSize: 11 }}>KEPADA (SUPPLIER)</div><div style={{ fontWeight: 700 }}>{vendor?.name}</div><div style={{ color: '#555' }}>{vendor?.contact ?? ''}</div></div>
        <table style={{ marginTop: 18 }}>
          <thead><tr style={{ background: '#f4f4f4' }}><th style={{ textAlign: 'left' }}>Bahan</th><th style={{ textAlign: 'right' }}>Jumlah</th><th style={{ textAlign: 'right' }}>Harga</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
          <tbody>
            {(lines ?? []).map((l, i) => { const m = matOf.get(l.material_id); const sub = Number(l.qty_ordered) * Number(l.unit_price); return (<tr key={i}><td>{m ? `${m.code} — ${m.name}` : l.material_id}</td><td style={{ textAlign: 'right' }}>{l.qty_ordered}</td><td style={{ textAlign: 'right' }}>{rp(Number(l.unit_price))}</td><td style={{ textAlign: 'right' }}>{rp(sub)}</td></tr>) })}
            <tr style={{ fontWeight: 700, background: '#fafafa' }}><td colSpan={3}>Total</td><td style={{ textAlign: 'right' }}>{rp(grand)}</td></tr>
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 40, fontFamily: 'Arial', fontSize: 12.5, textAlign: 'center' }}>
          <div><div style={{ color: '#555' }}>Disetujui (ACC),</div><div style={{ height: 52 }} /><div style={{ fontWeight: 700, borderTop: '1px solid #999', paddingTop: 4, minWidth: 180 }}>{po.approved_at ? new Date(po.approved_at).toLocaleDateString('id-ID') : ''}</div></div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify in browser**

Reload; on an approved order click `Cetak Surat`. Confirm the letter renders with correct number, vendor, and line items, and the sidebar/print button hide under print preview (`javascript_tool`: `window.matchMedia('print')` or just screenshot). Check console for errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/PrintButton.tsx "src/app/(app)/production/[id]/surat/page.tsx" "src/app/(app)/purchasing/[id]/surat/page.tsx" src/app/globals.css
git commit -m "feat: printable SPK + PO letter pages"
```

---

### Task 8: End-to-end flow test

**Files:**
- Create: `e2e/doc-approval.spec.ts`

- [ ] **Step 1: Write the test (follow existing e2e login pattern)**

Check an existing spec in `e2e/` for the login helper/pattern first, then:
```ts
import { test, expect } from '@playwright/test'

test('draft production order → ACC → cetak surat', async ({ page }) => {
  // login as owner (reuse the sign-in steps used by other specs in e2e/)
  await page.goto('/login')
  await page.getByPlaceholder('Email').fill('superadmin@vobia.com')
  await page.getByPlaceholder('Password').fill('password123')
  await page.getByRole('button', { name: 'Masuk' }).click()
  await page.waitForURL('/')

  // create a new production order (draft)
  await page.goto('/production/new')
  // ... fill style, vendor, one line, submit (match ProductionForm fields) ...

  // on detail: Draft badge + ACC visible, Cetak Surat absent
  await expect(page.getByText('Draft')).toBeVisible()
  await expect(page.getByRole('button', { name: 'ACC' })).toBeVisible()

  await page.getByRole('button', { name: 'ACC' }).click()
  await expect(page.getByText('Resmi')).toBeVisible()
  await page.getByRole('link', { name: 'Cetak Surat' }).click()
  await expect(page.getByText('SURAT PERINTAH KERJA')).toBeVisible()
})
```

- [ ] **Step 2: Run**

Run: `npm run e2e -- doc-approval`
Expected: PASS. (Dev server auto-starts on 3100 per `playwright.config.ts`.)

- [ ] **Step 3: Commit**

```bash
git add e2e/doc-approval.spec.ts
git commit -m "test: e2e draft → ACC → cetak surat"
```

---

## Notes for the implementer

- **New orders are drafts now.** After Task 1, every newly created production order / PO starts as `draft` and cannot issue/receive until approved. This is intended. Seed/simulation rows were backfilled to `approved`.
- **Role for ACC** comes from the JWT `user_role` claim in the DB; the UI reads the profile role via `getRole()`. `superadmin@vobia.com` is `owner`, so it can ACC.
- **No PDF dependency** — the letter is a normal page; printing is the browser's job.
- If any `vb-*` class referenced here doesn't exist, grep `src/app/globals.css` and reuse the closest existing one rather than inventing styles.
