# RBAC Lokasi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict location create to `owner`/`ops` at the DB (RLS) and UI; hide the Pengaturan/Lokasi menu from roles without access; keep reads tenant-wide (default-location lookup is cross-module).

**Architecture:** Smallest RBAC increment — one restrictive per-command write-RLS policy set on `locations` (no RPC to guard), a `canWriteLocation` helper, sidebar visibility gating, one gated form. Same pattern as prior increments. Spec: `docs/superpowers/specs/2026-07-17-rbac-lokasi-design.md`.

**Tech Stack:** Next.js App Router + Supabase (Postgres, RLS), pgTAP via `scripts/pgtap.mjs`.

## Global Constraints

- Write role set: `owner,ops`. View (menu + read-only) adds `inventory`.
- JWT role claim key is `user_role`. RLS strict `(auth.jwt()->>'user_role') in ('owner','ops')` (NULL → deny). No `coalesce(...,'owner')` fail-open. No fn guard (no RPC write path).
- READ never restricted: leave `tenant_isolation` (SELECT) on `locations` untouched; add only per-command WRITE policies (`for insert`/`for update`/`for delete`), NEVER `for all`. Policy names unique per command: `loc_write_insert`/`loc_write_update`/`loc_write_delete`.
- Migration `supabase/migrations/20260717000008_rbac_lokasi.sql`, pushed via `npx supabase db push --db-url "$SUPABASE_DB_URL"` (SUPABASE_DB_URL from `.env.local`, no Docker).
- No new demo accounts.
- Dev server port 3100 via preview tool; UI Bahasa Indonesia, `vb-*`; fresh browser tab per login, `document.querySelector('form').requestSubmit()` if a login click doesn't redirect.
- Commit after each task.

---

### Task 1: Migration + pgTAP + push

**Files:**
- Create: `supabase/migrations/20260717000008_rbac_lokasi.sql`
- Create: `supabase/tests/lokasi_access.test.sql`

**Interfaces:**
- Produces: `locations` rejects INSERT/UPDATE/DELETE from non-`owner`/`ops` roles at RLS; SELECT unchanged.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260717000008_rbac_lokasi.sql`:

```sql
-- RBAC Lokasi increment: gate location WRITES to owner/ops. READ stays
-- tenant-wide (default-location lookup is cross-module: receive/issue/produce).
-- No RPC write path — restrictive RLS is the whole DB gate. Fail-closed.
create policy loc_write_insert on public.locations as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
create policy loc_write_update on public.locations as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
create policy loc_write_delete on public.locations as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops'));
```

- [ ] **Step 2: Write the test**

`supabase/tests/lokasi_access.test.sql`. Note: the new-user trigger auto-seeds one default location per tenant, so a fresh tenant already has a `locations` row to read. INSERT denial via restrictive `with check` raises (exception-catch).

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('f1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','loc-owner@s.test','{"tenant_name":"Loc Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='f1111111-1111-1111-1111-111111111111');
  v_ops_uid uuid := 'f2222222-2222-2222-2222-222222222222';
  v_sales_uid uuid := 'f3333333-3333-3333-3333-333333333333';
  v_inv_uid uuid := 'f4444444-4444-4444-4444-444444444444';
  v_cnt int; v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_ops_uid,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','loc-ops@s.test'),
    (v_sales_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','loc-sales@s.test'),
    (v_inv_uid,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','loc-inv@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'ops'       where id = v_ops_uid;
  update public.profiles set tenant_id = v_tenant, role = 'sales'     where id = v_sales_uid;
  update public.profiles set tenant_id = v_tenant, role = 'inventory' where id = v_inv_uid;

  -- === ops: insert allowed ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);
  insert into public.locations (name) values ('Gudang Ops');
  reset role;

  -- === sales: insert blocked, read intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);
  v_failed := false;
  begin insert into public.locations (name) values ('Gudang Sales');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role created a location'; end if;
  select count(*) into v_cnt from public.locations where tenant_id = v_tenant;
  if v_cnt < 1 then raise exception 'FAIL: sales role cannot read locations'; end if;
  reset role;

  -- === inventory: insert blocked (view-only), read intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_inv_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','inventory')::text, true);
  perform set_config('role','authenticated', true);
  v_failed := false;
  begin insert into public.locations (name) values ('Gudang Inv');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: inventory role created a location'; end if;
  select count(*) into v_cnt from public.locations where tenant_id = v_tenant;
  if v_cnt < 1 then raise exception 'FAIL: inventory role cannot read locations'; end if;
  reset role;

  raise notice 'lokasi_access OK: ops writes, sales+inventory blocked on insert + reads intact';
end $$;

rollback;
```

- [ ] **Step 3: Push**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
npx supabase db push --db-url "$SUPABASE_DB_URL"
```
Expected: `20260717000008_rbac_lokasi.sql` applied cleanly.

- [ ] **Step 4: Run new test + full regression**

```bash
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/lokasi_access.test.sql
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: both `RESULT: PASS`. If any pre-existing test inserts into `locations` under an authenticated JWT without a `user_role` claim and now fails closed, add `'user_role','owner'` to its claims block — PURELY ADDITIVE (most already carry it; the new-user trigger + migration seeds run as postgres/definer and bypass RLS, so they're unaffected). Do NOT weaken assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260717000008_rbac_lokasi.sql supabase/tests/lokasi_access.test.sql
git commit -m "feat: RBAC lokasi write-gate (locations RLS owner/ops) + pgTAP"
```

---

### Task 2: role helper + sidebar + UI gating

**Files:**
- Modify: `src/lib/auth/role.ts`
- Modify: `src/components/SideNav.tsx`
- Modify: `src/app/(app)/locations/page.tsx`

**Interfaces:**
- Consumes: `getRole` from `@/lib/auth/role`.
- Produces: `canWriteLocation(role)=owner|ops`; Lokasi menu hidden for non-view roles; LocationForm gated.

- [ ] **Step 1: Append the helper to `role.ts`**

Append to `src/lib/auth/role.ts` (keep everything else):

```ts
// Lokasi (Pengaturan) role gate.
export const canWriteLocation = (role: string | null) => role === 'owner' || role === 'ops'
```

- [ ] **Step 2: Gate the Pengaturan/Lokasi sidebar item**

In `src/components/SideNav.tsx`, find:

```tsx
  { title: 'Pengaturan', items: [{ label: 'Lokasi', href: '/locations' }] },
```

Replace with:

```tsx
  { title: 'Pengaturan', items: [{ label: 'Lokasi', href: '/locations', roles: ['owner', 'ops', 'inventory'] }] },
```

- [ ] **Step 3: Gate `LocationForm` in `locations/page.tsx`**

Change the import line:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getRole, canWriteLocation } from '@/lib/auth/role'
import LocationForm from './LocationForm'
```

After `const supabase = await createClient()` add:

```tsx
  const canWrite = canWriteLocation(await getRole())
```

Replace the `<LocationForm />` usage:

```tsx
        {canWrite ? <LocationForm /> : (
          <div className="vb-card" style={{ padding: 18 }}>
            <div className="vb-cardtitle" style={{ marginBottom: 8 }}>Lokasi Baru</div>
            <div className="vb-muted" style={{ fontSize: 12.5 }}>Hanya role Ops/Owner yang bisa menambah lokasi.</div>
          </div>
        )}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/auth/role.ts src/components/SideNav.tsx "src/app/(app)/locations"
git commit -m "feat: lokasi role helper + sidebar gate + UI form gate"
```

---

### Task 3: E2E verify

**Files:** none.

- [ ] **Step 1: Full pgTAP regression**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: `RESULT: PASS`.

- [ ] **Step 2: Start dev server** via preview tool (`{name: "dev"}`, port 3100). Fresh browser tab per login; `document.querySelector('form').requestSubmit()` if a login click doesn't redirect.

- [ ] **Step 3: Log in as `ops.demo@vobia.test` / `password123`.** Verify: sidebar shows Pengaturan → Lokasi; `/locations` shows the Lokasi Baru form; can add a location.

- [ ] **Step 4: Log in as `inv.demo@vobia.test` / `password123`.** Verify: sidebar shows Pengaturan → Lokasi (inventory is a view role); `/locations` shows the "Hanya role Ops/Owner…" note instead of the form.

- [ ] **Step 5: Log in as `sales.demo@vobia.test` / `password123`.** Verify: sidebar has NO Pengaturan group; direct URL `/locations` loads read-only with the note.

- [ ] **Step 6: Owner regression** — `superadmin@vobia.com`: Lokasi fully writable, no regression.

- [ ] **Step 7: Screenshot** ops.demo (form) vs inv.demo (note) `/locations` as the artifact.
