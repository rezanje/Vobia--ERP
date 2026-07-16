# Role-Based Access: Sales vs Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two real demo accounts (Sales, Ops) that see different menus and are blocked at the database level — not just the UI — from writing (and in PCB/PPO's case, even reading) data outside their role, scoped to the 5 P1–P3 modules (Forecast, Proyeksi, Produk Baru, PCB, PPO).

**Architecture:** Add a `sales` role value to `profiles.role`. Every P1–P3 write already funnels through one of 6 SQL functions or 2 direct-table server actions (`new_products`, `po_payments`) — add an explicit role check at each of those 8 entry points (inside the function body for the 6 functions; as a Postgres RESTRICTIVE RLS policy for the 2 direct-table writes), plus tighten SELECT-level RLS on `pcb`/`pcb_lines`/`ppo` so `sales` cannot even read them. UI mirrors this with role-filtered sidebar items, page-level redirects, and disabled/hidden write controls — defense in depth, but the DB is the real gate.

**Tech Stack:** Next.js App Router + Supabase (Postgres, RLS, plpgsql), pgTAP via `scripts/pgtap.mjs`, `pg` client script for direct `auth.users` seeding.

## Global Constraints

- New role value: `sales`. Full check constraint after this change: `role in ('owner','sales','ops','production','inventory','finance','viewer')`.
- JWT role claim is `user_role` (see `supabase/migrations/20260701000004_fix_hook_role_claim.sql`) — read it in SQL as `(auth.jwt() ->> 'user_role')`, in TypeScript via `getRole()` in `src/lib/auth/role.ts`.
- Scope: only these 8 DB write-surfaces get role checks: `create_forecast`, `create_projection`, `lock_projection`, `create_pcb`, `create_ppo`, `issue_ppo_pos`, `new_products` (insert/update), `po_payments` (insert/update). Only these 3 tables get SELECT tightened: `pcb`, `pcb_lines`, `ppo`. No other existing module (HR, Keuangan, Produksi, Pembelian, etc.) is touched.
- Role → module matrix for tonight's scope (from spec, `owner` always full access, omitted below):
  - Forecast (kind=sales): `sales` writes, `ops` views only.
  - Forecast (kind=ops): `ops` writes, `sales` views only.
  - Proyeksi (create/lock), Produk Baru (create/update), PCB, PPO: `ops` writes; `sales` views Proyeksi/Produk Baru, has **zero** access to PCB/PPO.
- Migration file naming: `supabase/migrations/20260717NNNNNN_*.sql`, pushed via `npx supabase db push --db-url "$SUPABASE_DB_URL"` (`SUPABASE_DB_URL` read from `.env.local`, no Docker).
- Dev server port 3100, launched via the preview tool (`.claude/launch.json`), never via Bash.
- UI Bahasa Indonesia, `vb-*` classes only, following existing patterns (`purchasing/[id]/page.tsx`'s `getRole()`+`canApprove` usage, `IssueForm.tsx`'s locked-select-vs-plain-label pattern for FOB).
- Demo account passwords: `password123` (same as `superadmin@vobia.com`), same tenant as `superadmin@vobia.com`.
- Commit after each task.

---

### Task 1: Migration — add `sales` role

**Files:**
- Create: `supabase/migrations/20260717000001_role_sales.sql`

**Interfaces:**
- Produces: `profiles.role` accepts `'sales'`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260717000001_role_sales.sql`:

```sql
-- Add 'sales' as a valid app role (Sales-vs-Ops demo simulation).
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','sales','ops','production','inventory','finance','viewer'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260717000001_role_sales.sql
git commit -m "feat: add sales role to profiles"
```

Do NOT push yet — Task 4 pushes this together with Tasks 2 and 3.

---

### Task 2: Migration — role guards inside the 6 write functions

**Files:**
- Create: `supabase/migrations/20260717000002_role_guards_fns.sql`

**Interfaces:**
- Consumes: none new (rewrites existing fn bodies via `create or replace`).
- Produces: `create_forecast`, `create_projection`, `lock_projection`, `create_pcb`, `create_ppo`, `issue_ppo_pos` all reject callers whose `user_role` JWT claim isn't authorized, with a clear Indonesian `raise exception` message, BEFORE any other validation in the function.

**Why fn-internal checks, not RLS, for these 6:** all 6 are the sole write path into their tables (confirmed: no other INSERT/UPDATE site exists for `forecasts`, `forecast_lines`, `projections`, `projection_lines`, `pcb`, `pcb_lines`, `ppo`, and `issue_ppo_pos` is the only writer of `ppo_id`-tagged rows into the pre-existing `purchase_orders`/`purchase_lines`, which must NOT get a blanket role-RLS change since the legacy Pembelian flow also writes there). `lock_projection` is `security definer` — RLS does not apply to it at all when it runs, so its check MUST live inside the function body or role restriction would silently not exist for it.

- [ ] **Step 1: Write the migration — `create or replace` all 6 functions with the guard added**

`supabase/migrations/20260717000002_role_guards_fns.sql`:

```sql
-- Role guards for Sales-vs-Ops demo: each fn is the sole write path into its
-- table(s), so the check lives here rather than as blanket table RLS (which
-- would also need to special-case the legacy purchase_orders/purchase_lines
-- writers). lock_projection is `security definer` — RLS never applies to it,
-- so its guard is the only thing stopping a direct RPC call from a sales role.

create or replace function public.create_forecast(
  p_kind text, p_period text, p_notes text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_id uuid;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_kind not in ('sales','ops') then raise exception 'kind must be sales|ops'; end if;
  if p_kind = 'sales' and v_role not in ('owner','sales') then
    raise exception 'hanya role Sales/Owner yang boleh input forecast Sales';
  end if;
  if p_kind = 'ops' and v_role not in ('owner','ops') then
    raise exception 'hanya role Ops/Owner yang boleh input forecast Operasional';
  end if;
  if p_period !~ '^\d{4}-Q[1-4]$' then raise exception 'period must be YYYY-Qn'; end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then raise exception 'at least one line required'; end if;

  select id into v_id from public.forecasts where tenant_id = v_tenant and kind = p_kind and period = p_period;
  if v_id is null then
    insert into public.forecasts (tenant_id, kind, period, notes)
    values (v_tenant, p_kind, p_period, nullif(trim(p_notes), '')) returning id into v_id;
  else
    update public.forecasts set notes = nullif(trim(p_notes), '') where id = v_id;
    delete from public.forecast_lines where forecast_id = v_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.styles where id = (v_line ->> 'style_id')::uuid and tenant_id = v_tenant) then
      raise exception 'style not in tenant';
    end if;
    insert into public.forecast_lines (tenant_id, forecast_id, style_id, qty, ito, stock_ratio)
    values (v_tenant, v_id, (v_line ->> 'style_id')::uuid, (v_line ->> 'qty')::int,
            (v_line ->> 'ito')::numeric, (v_line ->> 'stock_ratio')::numeric);
  end loop;
  return v_id;
end;
$$;

create or replace function public.create_projection(
  p_period text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_id uuid;
  v_status text;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if v_role not in ('owner','ops') then raise exception 'hanya role Ops/Owner yang boleh membuat proyeksi'; end if;
  if p_period !~ '^\d{4}-Q[1-4]$' then raise exception 'period must be YYYY-Qn'; end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then raise exception 'at least one line required'; end if;

  select id, status into v_id, v_status from public.projections where tenant_id = v_tenant and period = p_period;
  if v_status = 'locked' then raise exception 'projection % already locked', p_period; end if;
  if v_id is null then
    insert into public.projections (tenant_id, period) values (v_tenant, p_period) returning id into v_id;
  else
    delete from public.projection_lines where projection_id = v_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.styles where id = (v_line ->> 'style_id')::uuid and tenant_id = v_tenant) then
      raise exception 'style not in tenant';
    end if;
    insert into public.projection_lines (tenant_id, projection_id, style_id, qty, kind, new_product_id)
    values (v_tenant, v_id, (v_line ->> 'style_id')::uuid, (v_line ->> 'qty')::int,
            coalesce(v_line ->> 'kind', 'regular'), (v_line ->> 'new_product_id')::uuid);
  end loop;
  return v_id;
end;
$$;

create or replace function public.lock_projection(p_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_status text;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if v_role not in ('owner','ops') then raise exception 'hanya role Ops/Owner yang boleh mengunci proyeksi'; end if;
  select status into v_status from public.projections where id = p_id and tenant_id = v_tenant for update;
  if v_status is null then raise exception 'projection not found'; end if;
  if v_status = 'locked' then raise exception 'already locked'; end if;
  if not exists (select 1 from public.projection_lines where projection_id = p_id) then
    raise exception 'projection has no lines';
  end if;
  update public.projections set status = 'locked', locked_at = now() where id = p_id;
end;
$$;

create or replace function public.create_pcb(
  p_projection_id uuid, p_quarter text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'PCB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_id uuid;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if v_role not in ('owner','ops') then raise exception 'hanya role Ops/Owner yang boleh membuat PCB'; end if;
  if p_quarter !~ '^\d{4}-Q[1-4]$' then raise exception 'quarter must be YYYY-Qn'; end if;
  if not exists (select 1 from public.projections
                  where id = p_projection_id and tenant_id = v_tenant and status = 'locked') then
    raise exception 'projection not found or not locked';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then raise exception 'at least one line required'; end if;

  insert into public.pcb (tenant_id, code, quarter, projection_id)
  values (v_tenant, v_code, p_quarter, p_projection_id) returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.styles where id = (v_line ->> 'style_id')::uuid and tenant_id = v_tenant) then
      raise exception 'style not in tenant';
    end if;
    insert into public.pcb_lines (tenant_id, pcb_id, style_id, target_sales, ending_stock, unit_cost)
    values (v_tenant, v_id, (v_line ->> 'style_id')::uuid,
            (v_line ->> 'target_sales')::int,
            coalesce((v_line ->> 'ending_stock')::int, 0),
            coalesce((v_line ->> 'unit_cost')::numeric, 0));
  end loop;
  return v_id;
end;
$$;

create or replace function public.create_ppo(
  p_pcb_id uuid, p_style_id uuid, p_scheme text, p_qty int, p_notes text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'PPO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if v_role not in ('owner','ops') then raise exception 'hanya role Ops/Owner yang boleh membuat PPO'; end if;
  if p_scheme not in ('fob','cmt') then raise exception 'scheme must be fob|cmt'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be > 0'; end if;
  if not exists (select 1 from public.pcb where id = p_pcb_id and tenant_id = v_tenant) then
    raise exception 'pcb not found';
  end if;
  if not exists (select 1 from public.pcb_lines where pcb_id = p_pcb_id and style_id = p_style_id) then
    raise exception 'style not in this pcb';
  end if;
  insert into public.ppo (tenant_id, code, pcb_id, style_id, scheme, qty, notes)
  values (v_tenant, v_code, p_pcb_id, p_style_id, p_scheme, p_qty, nullif(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.issue_ppo_pos(
  p_ppo_id uuid, p_children jsonb
) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_ppo public.ppo;
  v_loc uuid;
  v_child jsonb;
  v_i int := 0;
  v_type text;
  v_vendor uuid;
  v_po uuid;
  v_n int;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if v_role not in ('owner','ops') then raise exception 'hanya role Ops/Owner yang boleh menerbitkan PO dari PPO'; end if;
  select * into v_ppo from public.ppo where id = p_ppo_id and tenant_id = v_tenant for update;
  if v_ppo.id is null then raise exception 'ppo not found'; end if;
  if v_ppo.status <> 'draft' then raise exception 'ppo already issued'; end if;
  if p_children is null or jsonb_array_length(p_children) < 1 then raise exception 'at least one child PO required'; end if;
  v_n := jsonb_array_length(p_children);
  if v_ppo.scheme = 'fob' and v_n <> 1 then raise exception 'FOB: exactly 1 child PO'; end if;

  select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
  if v_loc is null then raise exception 'no default location'; end if;

  for v_child in select value from jsonb_array_elements(p_children) loop
    v_i := v_i + 1;
    v_type := v_child ->> 'po_type';
    v_vendor := (v_child ->> 'vendor_id')::uuid;
    if v_type is null then raise exception 'po_type required on each child'; end if;
    if v_ppo.scheme = 'fob' and v_type <> 'finished' then
      raise exception 'FOB child must be finished';
    end if;
    if v_ppo.scheme = 'cmt' and v_type not in ('material','sewing','bordir','accessory') then
      raise exception 'CMT child must be material|sewing|bordir|accessory';
    end if;
    if not exists (select 1 from public.vendors where id = v_vendor and tenant_id = v_tenant) then
      raise exception 'vendor not in tenant';
    end if;

    insert into public.purchase_orders (tenant_id, code, vendor_id, location_id, notes, ppo_id, po_type, amount)
    values (v_tenant, v_ppo.code || '-' || chr(64 + v_i), v_vendor, v_loc,
            nullif(trim(coalesce(v_child ->> 'notes', '')), ''),
            p_ppo_id, v_type, coalesce((v_child ->> 'amount')::numeric, 0))
    returning id into v_po;

    if v_type = 'material' and (v_child ->> 'material_id') is not null then
      if not exists (select 1 from public.materials where id = (v_child ->> 'material_id')::uuid and tenant_id = v_tenant) then
        raise exception 'material not in tenant';
      end if;
      insert into public.purchase_lines (tenant_id, po_id, material_id, qty_ordered, unit_price)
      values (v_tenant, v_po, (v_child ->> 'material_id')::uuid,
              (v_child ->> 'qty')::numeric, coalesce((v_child ->> 'unit_price')::numeric, 0));
    end if;
  end loop;

  update public.ppo set status = 'issued' where id = p_ppo_id;
end;
$$;
```

Note: no `grant execute` statements needed — `create or replace function` with unchanged argument types preserves the function's existing grants.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260717000002_role_guards_fns.sql
git commit -m "feat: role guards inside P1-P3 write functions (sales vs ops)"
```

---

### Task 3: Migration — RLS tightening (PCB/PPO read block, new_products/po_payments write gate)

**Files:**
- Create: `supabase/migrations/20260717000003_role_rls.sql`

**Interfaces:**
- Consumes: none new (replaces/adds RLS policies on existing tables).
- Produces: `sales` role gets zero SELECT on `pcb`/`pcb_lines`/`ppo`; `sales` role gets zero SELECT/write beyond the `for-all` policy... actually only WRITE is newly blocked on `new_products`/`po_payments` (SELECT stays open, per matrix `sales` 👁 on Produk Baru — `po_payments` has no explicit matrix row, left as-is for SELECT since it's only reachable from the PPO page sales can't open anyway). `forecasts`/`forecast_lines`/`projections`/`projection_lines` SELECT narrowed to `owner`/`sales`/`ops` only (kind-level write nuance stays enforced inside the Task 2 functions, not here).

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260717000003_role_rls.sql`:

```sql
-- Role-gate PCB/PPO entirely: sales has zero access (read or write) per the
-- access matrix. owner/ops keep full read+write. Both USING and WITH CHECK
-- carry the same tenant+role condition, replacing the old tenant-only policy.
drop policy tenant_isolation on public.pcb;
create policy tenant_isolation on public.pcb for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'));

drop policy tenant_isolation on public.pcb_lines;
create policy tenant_isolation on public.pcb_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'));

drop policy tenant_isolation on public.ppo;
create policy tenant_isolation on public.ppo for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'));

-- Forecast/Proyeksi family: readable+writable at the RLS layer by owner/sales/ops
-- (the fine-grained "which kind can sales/ops write" nuance is enforced inside
-- create_forecast/create_projection/lock_projection from Task 2, not here).
drop policy tenant_isolation on public.forecasts;
create policy tenant_isolation on public.forecasts for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'));

drop policy tenant_isolation on public.forecast_lines;
create policy tenant_isolation on public.forecast_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'));

drop policy tenant_isolation on public.projections;
create policy tenant_isolation on public.projections for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'));

drop policy tenant_isolation on public.projection_lines;
create policy tenant_isolation on public.projection_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'));

-- new_products: SELECT stays open to the whole tenant (sales can view, per
-- matrix 👁) via the existing tenant_isolation policy, untouched. Add a
-- RESTRICTIVE policy that narrows INSERT/UPDATE to owner/ops only — restrictive
-- policies AND on top of the permissive tenant_isolation policy, so this adds
-- a role requirement without reopening or changing read access.
create policy write_role_gate on public.new_products as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
create policy write_role_gate on public.new_products as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));

-- po_payments: same technique — SELECT untouched, write narrowed to owner/ops.
create policy write_role_gate on public.po_payments as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
create policy write_role_gate on public.po_payments as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260717000003_role_rls.sql
git commit -m "feat: RLS role-gate PCB/PPO reads, restrict new_products/po_payments writes"
```

---

### Task 4: Push migrations + pgTAP role-access test

**Files:**
- Create: `supabase/tests/role_access.test.sql`

**Interfaces:**
- Consumes: Tasks 1–3 (pushed to the live DB).
- Produces: DB has the `sales` role + all guards live; test proves it.

- [ ] **Step 1: Write the test**

`supabase/tests/role_access.test.sql`. This test seeds fixtures as `postgres` (bypasses RLS), then repeatedly switches the session's JWT claims via `set_config('request.jwt.claims', ...)` + `set_config('role','authenticated', true)` to act as a specific role, asserting both the positive (allowed) and negative (blocked) paths. Read `supabase/migrations/20260701000005_product_spine.sql` and `20260709000002_materials.sql` first to confirm the exact required columns for `styles`/`materials`/`vendors` inserts (a prior test hit a `materials.category` NOT NULL column the migration file's own comments didn't call out — verify against the live schema, not assumptions) — adapt fixture inserts if a column differs, but do not weaken any assertion below.

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('b1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','owner-role@s.test','{"tenant_name":"Role Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='b1111111-1111-1111-1111-111111111111');
  v_sales_uid uuid := 'b2222222-2222-2222-2222-222222222222';
  v_ops_uid uuid := 'b3333333-3333-3333-3333-333333333333';
  v_style uuid;
  v_vendor uuid;
  v_proj uuid;
  v_pcb uuid;
  v_ppo uuid;
  v_cnt int;
  v_failed boolean;
begin
  -- second/third tenant member, same tenant, roles sales/ops
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_sales_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sales-role@s.test'),
    (v_ops_uid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ops-role@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'sales' where id = v_sales_uid;
  update public.profiles set tenant_id = v_tenant, role = 'ops'   where id = v_ops_uid;

  insert into public.styles (tenant_id, code, name) values (v_tenant, 'ROLE-01', 'Role Test Style') returning id into v_style;
  insert into public.vendors (tenant_id, name) values (v_tenant, 'Role Vendor') returning id into v_vendor;

  -- === sales role: allowed sales-kind forecast, blocked from ops-kind ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text, 'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  perform public.create_forecast('sales', '2026-Q3', null, jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));

  v_failed := false;
  begin
    perform public.create_forecast('ops', '2026-Q3', null, jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: sales role was able to create an ops-kind forecast'; end if;

  -- sales blocked from create_projection, lock_projection, create_pcb, create_ppo, issue_ppo_pos
  v_failed := false;
  begin perform public.create_projection('2026-Q3', jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to create a projection'; end if;

  v_failed := false;
  begin perform public.create_pcb(gen_random_uuid(), '2026-Q3', jsonb_build_array(jsonb_build_object('style_id', v_style, 'target_sales', 10)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to call create_pcb'; end if;

  v_failed := false;
  begin perform public.create_ppo(gen_random_uuid(), v_style, 'fob', 10, null);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to call create_ppo'; end if;

  v_failed := false;
  begin perform public.issue_ppo_pos(gen_random_uuid(), jsonb_build_array(jsonb_build_object('po_type','finished','vendor_id',v_vendor,'amount',1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to call issue_ppo_pos'; end if;

  v_failed := false;
  begin insert into public.new_products (name) values ('Sales Cannot Create');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to insert into new_products'; end if;

  reset role;

  -- === ops role: full write chain forecast(ops) -> projection -> lock -> pcb -> ppo -> issue, blocked from forecast(sales) ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text, 'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_forecast('sales', '2026-Q4', null, jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role was able to create a sales-kind forecast'; end if;

  perform public.create_forecast('ops', '2026-Q4', null, jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  v_proj := public.create_projection('2026-Q4', jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  perform public.lock_projection(v_proj);
  v_pcb := public.create_pcb(v_proj, '2026-Q4', jsonb_build_array(jsonb_build_object('style_id', v_style, 'target_sales', 100, 'ending_stock', 0, 'unit_cost', 1000)));
  v_ppo := public.create_ppo(v_pcb, v_style, 'fob', 100, null);
  perform public.issue_ppo_pos(v_ppo, jsonb_build_array(jsonb_build_object('po_type','finished','vendor_id',v_vendor,'amount',100000)));

  insert into public.new_products (name) values ('Ops Can Create');

  reset role;

  -- === RLS SELECT block: sales sees zero pcb/ppo rows even though they now exist ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text, 'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  select count(*) into v_cnt from public.pcb where id = v_pcb;
  if v_cnt <> 0 then raise exception 'FAIL: sales role could SELECT a pcb row'; end if;
  select count(*) into v_cnt from public.ppo where id = v_ppo;
  if v_cnt <> 0 then raise exception 'FAIL: sales role could SELECT a ppo row'; end if;

  reset role;
  raise notice 'role_access OK: forecast kind guard, projection/pcb/ppo/issue writer guard (incl. security-definer lock_projection), new_products write guard, pcb/ppo SELECT block for sales';
end $$;

rollback;
```

- [ ] **Step 2: Push migrations**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
npx supabase db push --db-url "$SUPABASE_DB_URL"
```
Expected: 3 new migrations applied with no error.

- [ ] **Step 3: Run the test**

```bash
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/role_access.test.sql
```
Expected: `role_access OK: ...` then `RESULT: PASS`. On failure, diagnose against the actual migration SQL (Tasks 1–3) — fix the migration file, re-push, re-run. Do not weaken an assertion to force a pass.

- [ ] **Step 4: Run full regression suite**

```bash
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: `RESULT: PASS` (no existing test broken by the RLS changes — pay special attention to `planning.test.sql`, which exercises the same tables under an `owner`-equivalent role and must still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/role_access.test.sql
git commit -m "test: pgTAP role-access guard (sales vs ops writer/reader checks)"
```

---

### Task 5: Seed the two demo accounts

**Files:**
- Create: `scripts/seed-users.mjs`

**Interfaces:**
- Consumes: an existing owner account (default `superadmin@vobia.com`) already in the DB.
- Produces: two login-capable accounts — `sales.demo@vobia.test` (role `sales`) and `ops.demo@vobia.test` (role `ops`) — in the SAME tenant as the owner account, password `password123`.

- [ ] **Step 1: Write the script**

`scripts/seed-users.mjs`:

```js
// Seed two role-restricted demo accounts (Sales, Ops) into the SAME tenant as an
// existing owner account, for the sales-vs-ops access-control demo.
//
//   node scripts/seed-users.mjs [owner_email]   # defaults to superadmin@vobia.com
//
// Runs as the postgres role over the pooler (SUPABASE_DB_URL in .env.local), so it
// can insert into auth.users directly. The new-user trigger (handle_new_user) fires
// on that insert and creates a brand-new tenant + role='owner' profile for each
// account; this script immediately overwrites that profile (tenant_id, role) to
// join the target tenant instead, then deletes the orphaned tenant it doesn't need.
// Idempotent: re-running just re-applies tenant_id/role on the existing accounts.

import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const DB = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
if (!DB) throw new Error('SUPABASE_DB_URL not found in .env.local');

const OWNER_EMAIL = process.argv[2] || 'superadmin@vobia.com';
const DEMO_PASSWORD = 'password123';
const DEMO_USERS = [
  { email: 'sales.demo@vobia.test', role: 'sales', full_name: 'Sales Demo' },
  { email: 'ops.demo@vobia.test', role: 'ops', full_name: 'Ops Demo' },
];

const c = new Client({ connectionString: DB });

await c.connect();
try {
  await c.query('begin');

  const { rows: [owner] } = await c.query(
    `select p.tenant_id from public.profiles p join auth.users u on u.id = p.id where u.email = $1`,
    [OWNER_EMAIL]);
  if (!owner) throw new Error(`owner ${OWNER_EMAIL} not found — sign up first`);
  const TENANT = owner.tenant_id;
  console.log('target tenant', TENANT);

  for (const du of DEMO_USERS) {
    const { rows: [existing] } = await c.query('select id from auth.users where email=$1', [du.email]);
    let uid = existing?.id;

    if (!uid) {
      const { rows: [created] } = await c.query(
        `insert into auth.users
           (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values
           ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            $1, crypt($2, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('full_name', $3::text),
            now(), now())
         returning id`,
        [du.email, DEMO_PASSWORD, du.full_name]);
      uid = created.id;
      console.log('created auth user', du.email, uid);
    } else {
      console.log('auth user already exists', du.email, uid);
    }

    // handle_new_user() trigger fired on the INSERT above (fresh accounts only) and
    // created a profile pointed at a brand-new tenant with role='owner'. Repoint it.
    const { rows: [prof] } = await c.query('select tenant_id from public.profiles where id=$1', [uid]);
    const orphanTenant = prof?.tenant_id && prof.tenant_id !== TENANT ? prof.tenant_id : null;

    await c.query(
      `update public.profiles set tenant_id=$1, role=$2, full_name=$3 where id=$4`,
      [TENANT, du.role, du.full_name, uid]);

    if (orphanTenant) {
      await c.query('delete from public.tenants where id=$1 and id <> $2', [orphanTenant, TENANT]);
      console.log('cleaned up orphan tenant', orphanTenant);
    }
  }

  await c.query('commit');
  const { rows: summary } = await c.query(
    `select u.email, p.role, p.tenant_id from auth.users u join public.profiles p on p.id=u.id
      where u.email = any($1)`, [DEMO_USERS.map((d) => d.email)]);
  console.log('done:', summary);
} catch (e) {
  await c.query('rollback');
  throw e;
} finally {
  await c.end();
}
```

- [ ] **Step 2: Run it**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
node scripts/seed-users.mjs superadmin@vobia.com
```
Expected: `done: [ { email: 'sales.demo@vobia.test', role: 'sales', tenant_id: <same as superadmin> }, { email: 'ops.demo@vobia.test', role: 'ops', tenant_id: <same> } ]`.

- [ ] **Step 3: Verify login works** — use the preview tool (browser pane) to log in as `sales.demo@vobia.test` / `password123` at `http://localhost:3100/login`, confirm it succeeds and lands past `/login` (full UI verification happens in Task 10; this step only confirms the account is login-capable before building UI around it).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-users.mjs
git commit -m "feat: seed sales/ops demo accounts into existing tenant"
```

---

### Task 6: `role.ts` helpers

**Files:**
- Modify: `src/lib/auth/role.ts`

**Interfaces:**
- Consumes: existing `getRole()`.
- Produces: `canWriteSalesForecast(role)`, `canWriteOpsForecast(role)`, `canWritePpic(role)`, `canViewPpic(role)` — all `(role: string | null) => boolean`, consumed by Tasks 7–9.

- [ ] **Step 1: Add the helpers**

Full new content of `src/lib/auth/role.ts`:

```ts
import { createClient } from '@/lib/supabase/server'

// Current user's app role from their profile
// (owner/sales/ops/production/inventory/finance/viewer).
export async function getRole(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return data?.role ?? null
}

export const canApprove = (role: string | null) => role === 'owner' || role === 'ops'

// P1-P3 planning/PPIC role gates (Sales vs Ops demo simulation).
export const canWriteSalesForecast = (role: string | null) => role === 'owner' || role === 'sales'
export const canWriteOpsForecast = (role: string | null) => role === 'owner' || role === 'ops'
export const canWritePpic = (role: string | null) => role === 'owner' || role === 'ops'
export const canViewPpic = (role: string | null) => role === 'owner' || role === 'ops'
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/auth/role.ts
git commit -m "feat: role helpers for sales/ops PPIC access gates"
```

---

### Task 7: Sidebar + AppShell role filtering

**Files:**
- Modify: `src/components/SideNav.tsx`
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `getRole()` from `src/lib/auth/role.ts` (Task 6, though this task only needs the pre-existing `getRole`, not the new helpers).
- Produces: `<SideNav role={string | null}>` prop; menu items tagged `roles?: string[]` are hidden when the current role isn't listed; a group that ends up with zero visible items renders nothing.

- [ ] **Step 1: Update `SideNav.tsx`**

Replace lines 1–18 (imports + `GROUPS` + type) with:

```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { logout } from '@/app/auth/actions'

const GROUPS: { title?: string; items: { label: string; href: string; roles?: string[] }[] }[] = [
  { items: [{ label: 'Dashboard', href: '/' }] },
  { title: 'Perencanaan', items: [
      { label: 'Forecast', href: '/forecasts', roles: ['owner', 'sales', 'ops'] },
      { label: 'Proyeksi', href: '/projections', roles: ['owner', 'sales', 'ops'] },
      { label: 'Produk Baru', href: '/new-products', roles: ['owner', 'sales', 'ops'] },
    ] },
  { title: 'PPIC', items: [
      { label: 'PCB', href: '/pcb', roles: ['owner', 'ops'] },
      { label: 'PPO', href: '/ppo', roles: ['owner', 'ops'] },
    ] },
  { title: 'Produk', items: [{ label: 'Styles', href: '/styles' }, { label: 'Stok', href: '/stock' }, { label: 'Bahan', href: '/materials' }, { label: 'HPP', href: '/costing' }] },
  { title: 'Produksi', items: [{ label: 'Produksi', href: '/production' }, { label: 'Vendor', href: '/vendors' }] },
  { title: 'Penjualan', items: [{ label: 'Order', href: '/orders' }, { label: 'Channel', href: '/channels' }, { label: 'Retur', href: '/returns' }] },
  { title: 'Pembelian', items: [{ label: 'Pembelian', href: '/purchasing' }, { label: 'Stok Bahan', href: '/material-stock' }] },
  { title: 'Keuangan', items: [{ label: 'Bagan Akun', href: '/accounts' }, { label: 'Jurnal', href: '/journals' }, { label: 'Neraca Saldo', href: '/reports/trial-balance' }, { label: 'Laba-Rugi', href: '/reports/income' }, { label: 'Neraca', href: '/reports/balance-sheet' }] },
  { title: 'HR', items: [{ label: 'Karyawan', href: '/employees' }, { label: 'Komponen Gaji', href: '/pay-components' }, { label: 'Proses Gaji', href: '/payroll' }] },
  { title: 'Pengaturan', items: [{ label: 'Lokasi', href: '/locations' }] },
]

const STORE_KEY = 'vb-nav-collapsed'
```

Replace the component signature and the `GROUPS.map` block (currently lines 22 and 47–70) — full new component body:

```tsx
export default function SideNav({ role }: { role: string | null }) {
  const path = usePathname()
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))
  // set of collapsed group titles; empty = all open. Loaded from localStorage after mount
  // (not during render) to avoid an SSR/client hydration mismatch.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (raw) setCollapsed(new Set(JSON.parse(raw)))
    } catch { /* ignore corrupt/absent storage */ }
  }, [])

  const toggle = (title: string) => setCollapsed((prev) => {
    const next = new Set(prev)
    next.has(title) ? next.delete(title) : next.add(title)
    try { localStorage.setItem(STORE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
    return next
  })

  return (
    <aside className="vb-side">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vobia-logo-white.png" alt="Vobia" className="vb-logo" />
      <nav className="vb-nav">
        {GROUPS.map((g, i) => {
          const items = g.items.filter((it) => !it.roles || it.roles.includes(role ?? ''))
          if (!items.length) return null
          // the group holding the current page always shows, even if the user collapsed it
          const hasActive = items.some((it) => active(it.href))
          const open = !g.title || hasActive || !collapsed.has(g.title)
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {g.title && (
                <button
                  type="button"
                  className="vb-navgroup-title"
                  onClick={() => toggle(g.title!)}
                  aria-expanded={open}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                >
                  {g.title}
                  <span aria-hidden style={{ transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none', fontSize: 9, opacity: 0.6 }}>▶</span>
                </button>
              )}
              {open && items.map((it) => (
                <Link key={it.href} href={it.href} className={`vb-navitem${active(it.href) ? ' on' : ''}`}>{it.label}</Link>
              ))}
            </div>
          )
        })}
      </nav>
      <div className="vb-sidefoot">
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--vb-accent)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Vobia Studio</div>
          <div style={{ fontSize: 11, color: 'var(--vb-muted)' }}>Ops · Jakarta</div>
        </div>
        <form action={logout}>
          <button type="submit" style={{ background: 'none', border: 'none', color: 'var(--vb-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Keluar</button>
        </form>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Update `AppShell.tsx`**

Full new content:

```tsx
import SideNav from '@/components/SideNav'
import { getRole } from '@/lib/auth/role'

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  return (
    <div className="vb-app">
      <SideNav role={role} />
      <main className="vb-main"><div className="vb-container">{children}</div></main>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/SideNav.tsx src/components/AppShell.tsx
git commit -m "feat: role-filtered sidebar (sales/ops see different menus)"
```

---

### Task 8: P1 pages — role-aware forms (Forecast, Proyeksi, Produk Baru)

**Files:**
- Modify: `src/app/(app)/forecasts/page.tsx`
- Modify: `src/app/(app)/forecasts/ForecastForm.tsx`
- Modify: `src/app/(app)/projections/page.tsx`
- Modify: `src/app/(app)/projections/AlignmentForm.tsx`
- Modify: `src/app/(app)/projections/[id]/page.tsx`
- Modify: `src/app/(app)/new-products/page.tsx`
- Modify: `src/app/(app)/new-products/NewProductForm.tsx`
- Modify: `src/app/(app)/new-products/NewProductRow.tsx`

**Interfaces:**
- Consumes: `getRole`, `canWritePpic` from `@/lib/auth/role` (Task 6). `ForecastForm` locks its own `kind` field directly off the raw `role` string (not a boolean helper, since it needs 3-way behavior: locked-to-sales / locked-to-ops / free-for-owner).
- Produces: all 5 write surfaces (`ForecastForm` kind, `AlignmentForm` submit, `LockButton` visibility, `NewProductForm` visibility, `NewProductRow` edit) respect role. No pages redirect here — every role that can see these 3 modules (`owner`,`sales`,`ops`) may open them; only write controls change.

- [ ] **Step 1: `forecasts/page.tsx`** — fetch role, pass to form

Change the import line and the component body:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getRole } from '@/lib/auth/role'
import ForecastForm from './ForecastForm'
```

Inside `ForecastsPage`, right after `const supabase = await createClient()`, add:

```tsx
  const role = await getRole()
```

Change the final render line from `<ForecastForm styles={styles ?? []} />` to:

```tsx
        <ForecastForm styles={styles ?? []} role={role} />
```

- [ ] **Step 2: `ForecastForm.tsx`** — lock `kind` to the caller's role

Replace the component signature and the `kind` state init:

```tsx
export default function ForecastForm({ styles, role }: { styles: StyleOption[]; role: string | null }) {
  const locked = role === 'sales' ? 'sales' : role === 'ops' ? 'ops' : null
  const [kind, setKind] = useState<'sales' | 'ops'>(locked ?? 'sales')
```

Change the reset line inside `onSave` (currently `setKind('sales'); setPeriod(''); ...`) to:

```tsx
    setKind(locked ?? 'sales'); setPeriod(''); setNotes(''); setRows([{ ...EMPTY_ROW }])
```

Replace the "Jenis" field block:

```tsx
        <div>
          <label className="vb-label">Jenis</label>
          {locked ? (
            <div className="vb-label" style={{ margin: 0, alignSelf: 'center' }}>{locked === 'sales' ? 'Sales' : 'Operasional'}</div>
          ) : (
            <select className="vb-input" value={kind} onChange={(e) => setKind(e.target.value as 'sales' | 'ops')}>
              <option value="sales">Sales</option>
              <option value="ops">Operasional</option>
            </select>
          )}
        </div>
```

- [ ] **Step 3: `projections/page.tsx`** — fetch role + `canWrite`, pass to `AlignmentForm`

Change the import line:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getRole, canWritePpic } from '@/lib/auth/role'
import AlignmentForm from './AlignmentForm'
```

Inside `ProjectionsPage`, right after `const supabase = await createClient()`, add:

```tsx
  const canWrite = canWritePpic(await getRole())
```

Change the final render line from `<AlignmentForm periods={periods} styles={styles ?? []} newProducts={newProducts} />` to:

```tsx
        <AlignmentForm periods={periods} styles={styles ?? []} newProducts={newProducts} canWrite={canWrite} />
```

- [ ] **Step 4: `AlignmentForm.tsx`** — hide submit for non-writers

Change the component signature:

```tsx
export default function AlignmentForm({ periods, styles, newProducts, canWrite }: { periods: PeriodData[]; styles: StyleOption[]; newProducts: NewProductOption[]; canWrite: boolean }) {
```

Replace the submit button block (the `<button className="vb-btn" type="button" disabled={saving} onClick={onSave}>...` at the end, just before the closing `</>`):

```tsx
          {canWrite ? (
            <button className="vb-btn" type="button" disabled={saving} onClick={onSave}>
              {saving ? 'Menyimpan…' : 'Buat Proyeksi'}
            </button>
          ) : (
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya tim Ops/Owner yang bisa membuat proyeksi. Anda bisa melihat perbandingan Sales vs Ops di atas.</div>
          )}
```

- [ ] **Step 5: `projections/[id]/page.tsx`** — hide `LockButton` / "Buat PCB" link for non-writers

Change the import line:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canWritePpic } from '@/lib/auth/role'
import LockButton from './LockButton'
```

Inside `ProjectionDetail`, right after `const { id } = await params`, add:

```tsx
  const canWrite = canWritePpic(await getRole())
```

Replace the conditional action block:

```tsx
        {projection.status === 'draft' ? (
          canWrite ? <LockButton id={projection.id} /> : <span className="vb-badge" style={{ background: 'rgba(227,196,110,.13)', color: '#e3c46e' }}>Menunggu dikunci Ops</span>
        ) : canWrite ? (
          <Link href={`/pcb/new?projection=${projection.id}`} className="vb-btn">Buat PCB dari proyeksi ini →</Link>
        ) : (
          <span className="vb-muted" style={{ fontSize: 12.5 }}>Terkunci — PCB dibuat oleh tim Ops</span>
        )}
```

- [ ] **Step 6: `new-products/page.tsx`** — fetch role + `canWrite`, conditionally render form, pass to rows

Change the import line:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getRole, canWritePpic } from '@/lib/auth/role'
import NewProductForm from './NewProductForm'
import NewProductRow from './NewProductRow'
```

Inside `NewProductsPage`, right after `const supabase = await createClient()`, add:

```tsx
  const canWrite = canWritePpic(await getRole())
```

Replace the render block:

```tsx
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}>
        <div className="vb-card" style={{ overflow: 'hidden' }}>
          {!newProducts?.length ? (
            <div className="vb-empty">Belum ada produk baru.</div>
          ) : newProducts.map((p) => <NewProductRow key={p.id} p={p} canWrite={canWrite} />)}
        </div>
        {canWrite ? <NewProductForm styles={styles ?? []} /> : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>Produk Baru</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya tim Ops/Owner yang bisa menambah/mengubah produk baru. Anda bisa melihat status di sebelah kiri.</div>
          </div>
        )}
      </div>
```

- [ ] **Step 7: `NewProductRow.tsx`** — disable edit controls when `!canWrite`

Change the component signature:

```tsx
export default function NewProductRow({ p, canWrite }: { p: NP; canWrite: boolean }) {
```

Update the 3 controls and the button — replace the JSX body's controls block:

```tsx
      <select className="vb-input" value={rnd} onChange={(e) => setRnd(e.target.value)} disabled={!canWrite}>
        <option value="design">Desain</option>
        <option value="prototype">Prototipe</option>
        <option value="done">Selesai</option>
      </select>
      <select className="vb-input" value={mkt} onChange={(e) => setMkt(e.target.value)} disabled={!canWrite}>
        <option value="belum">Belum</option>
        <option value="cek_ombak">Cek Ombak</option>
        <option value="tervalidasi">Tervalidasi</option>
      </select>
      <input className="vb-input" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} disabled={!canWrite} />
      {canWrite && <button type="button" className="vb-btn-mini" disabled={saving} onClick={onSave}>{saving ? '…' : 'Simpan'}</button>}
```

(`NewProductForm.tsx` itself needs no internal change — Step 6 already conditionally renders it entirely.)

- [ ] **Step 8: Typecheck + commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/forecasts" "src/app/(app)/projections" "src/app/(app)/new-products"
git commit -m "feat: P1 UI role gating (forecast kind lock, projection/produk-baru write gate)"
```

---

### Task 9: P2/P3 pages — redirect non-owner/ops away from PCB/PPO

**Files:**
- Modify: `src/app/(app)/pcb/page.tsx`
- Modify: `src/app/(app)/pcb/new/page.tsx`
- Modify: `src/app/(app)/pcb/[id]/page.tsx`
- Modify: `src/app/(app)/ppo/page.tsx`
- Modify: `src/app/(app)/ppo/[id]/page.tsx`

**Interfaces:**
- Consumes: `getRole`, `canViewPpic` from `@/lib/auth/role` (Task 6).
- Produces: any role other than `owner`/`ops` hitting any of these 5 routes (including direct URL entry) is redirected to `/` before any data is fetched.

- [ ] **Step 1: `pcb/page.tsx`**

Change the import line:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canViewPpic } from '@/lib/auth/role'
import { rp } from '@/lib/ui'
```

Inside `PcbListPage`, as the very first line of the function body (before `const supabase = ...`):

```tsx
  if (!canViewPpic(await getRole())) redirect('/')
```

- [ ] **Step 2: `pcb/new/page.tsx`**

Change the import line:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canViewPpic } from '@/lib/auth/role'
import PcbForm from './PcbForm'
```

Inside `PcbNewPage`, as the very first line of the function body (before `const { projection: projectionId } = await searchParams`):

```tsx
  if (!canViewPpic(await getRole())) redirect('/')
```

- [ ] **Step 3: `pcb/[id]/page.tsx`**

Change the import line:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canViewPpic } from '@/lib/auth/role'
import PpoForm from './PpoForm'
import { rp } from '@/lib/ui'
```

Inside `PcbDetail`, as the very first line of the function body (before `const { id } = await params`):

```tsx
  if (!canViewPpic(await getRole())) redirect('/')
```

- [ ] **Step 4: `ppo/page.tsx`**

Change the import line:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canViewPpic } from '@/lib/auth/role'
```

Inside `PpoListPage`, as the very first line of the function body:

```tsx
  if (!canViewPpic(await getRole())) redirect('/')
```

- [ ] **Step 5: `ppo/[id]/page.tsx`**

Change the import line:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRole, canViewPpic } from '@/lib/auth/role'
import IssueForm from './IssueForm'
import PaymentPanel from './PaymentPanel'
import { rp, PO_TYPE_LABEL } from '@/lib/ui'
```

Inside `PpoDetail`, as the very first line of the function body (before `const { id } = await params`):

```tsx
  if (!canViewPpic(await getRole())) redirect('/')
```

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/pcb" "src/app/(app)/ppo"
git commit -m "feat: redirect non-owner/ops roles away from PCB/PPO pages"
```

---

### Task 10: E2E verify — both demo accounts, full regression

**Files:** none (verification only).

- [ ] **Step 1: Full pgTAP regression**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: `RESULT: PASS`.

- [ ] **Step 2: Start dev server** via the preview tool (`{name: "dev"}`, port 3100) — never via Bash.

- [ ] **Step 3: Log in as `sales.demo@vobia.test` / `password123`.** Verify via `read_page`/screenshot:
  - Sidebar shows **Forecast, Proyeksi, Produk Baru** under Perencanaan; **no PPIC group** (PCB/PPO absent entirely).
  - `/forecasts`: "Jenis" field shows fixed label "Sales" (no dropdown); can submit a new Sales forecast successfully.
  - `/projections`: alignment table visible for a period with data; submit area shows the "Hanya tim Ops/Owner..." note, no active "Buat Proyeksi" button.
  - `/projections/[id]` (an existing draft, if any, or the Q4 one created by ops in Task 4's test — note that test data was rolled back, so use whatever real draft exists from earlier seeding/demo, or create one first as ops): draft shows "Menunggu dikunci Ops" badge, not a Lock button.
  - `/new-products`: rows show disabled selects, no "Simpan" button; right panel shows the Ops-only note instead of the create form.
  - Direct URL navigation to `http://localhost:3100/pcb` → redirected to `/`.
  - Direct URL navigation to `http://localhost:3100/ppo` → redirected to `/`.

- [ ] **Step 4: Log out, log in as `ops.demo@vobia.test` / `password123`.** Verify:
  - Sidebar shows **Forecast, Proyeksi, Produk Baru, PCB, PPO** (full P1–P3 access).
  - `/forecasts`: "Jenis" field shows fixed label "Operasional"; can submit a new Ops forecast.
  - `/projections`: full alignment form usable, "Buat Proyeksi" button active; can create + lock a projection end to end.
  - `/pcb`, `/pcb/new?projection=<locked id>`, `/pcb/[id]`, `/ppo`, `/ppo/[id]`: all reachable and fully functional (create PCB, create PPO, issue child POs, add payments) — same flow already proven in the manufacturing-upstream demo, now under the `ops` role instead of `owner`.

- [ ] **Step 5: Check for regressions on the `owner` account** (`superadmin@vobia.com`): log in, confirm the sidebar still shows every group (including HR/Keuangan/etc., untouched), and that `/pcb`, `/ppo`, `/forecasts`, `/projections`, `/new-products` all still work exactly as before (owner is unrestricted throughout every check in this plan).

- [ ] **Step 6: Screenshot both role sidebars side by side** (sales vs ops) as the artifact to show the client — save via the preview tool's screenshot action, no extra step needed beyond capturing during Steps 3–4.
