# Manufacturing Upstream (P1–P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alur demo-walkable Forecast → Projection → PCB → PPO → PO (FOB & CMT) → nyambung ke produksi/WMS existing, siap demo besok.

**Architecture:** 3 modul berantai (planning → ppic → procurement) di atas pola existing: migrasi SQL multi-tenant + RLS, fungsi plpgsql sebagai satu-satunya jalur tulis berlogika, server actions tipis di `src/lib/<mod>/actions.ts`, halaman server component + form client component pakai kelas `vb-*`. Spec: `docs/superpowers/specs/2026-07-16-manufacturing-upstream-design.md`.

**Tech Stack:** Next.js App Router + Supabase (Postgres, RLS, plpgsql), pgTAP via `scripts/pgtap.mjs`, seeder `scripts/seed-demo.mjs`.

## Global Constraints

- Multi-tenant: SEMUA tabel baru punya `tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id)` + policy `tenant_isolation` + grant ke `authenticated` (pola persis migrasi existing).
- Migrasi: file baru `supabase/migrations/20260716NNNNNN_*.sql`, push via `npx supabase db push --db-url "$SUPABASE_DB_URL"` (pooler, TANPA Docker — baca `SUPABASE_DB_URL` dari `.env.local`).
- Dev server port 3100 (3000 dipakai project lain). Jalankan via preview tool, bukan Bash.
- UI Bahasa Indonesia, pakai kelas `vb-*` existing (`vb-card`, `vb-input`, `vb-btn`, `vb-badge`, `vb-thead`, `vb-row`, `vb-h1`, `vb-sub`, `vb-label`, `vb-empty`, `vb-mono`, `vb-muted`, `vb-danger`, `vb-cardtitle`, `vb-rowlink`).
- Formula supply (SOP klien, literal): `supply_qty = ending_stock + target_sales`.
- Period/quarter format teks `YYYY-Qn` (contoh `2026-Q3`) di forecast, projection, PCB.
- Commit tiap task selesai. Format commit ikuti repo (`feat: ...`).

---

### Task 1: Migrasi P1 — planning schema + fns

**Files:**
- Create: `supabase/migrations/20260716000001_planning_schema.sql`
- Create: `supabase/migrations/20260716000002_planning_fns.sql`

**Interfaces:**
- Produces: tabel `forecasts`, `forecast_lines`, `new_products`, `projections`, `projection_lines`; fn `create_forecast(text,text,text,jsonb) returns uuid`, `create_projection(text,jsonb) returns uuid`, `lock_projection(uuid) returns void`.

- [ ] **Step 1: Tulis migrasi schema**

`supabase/migrations/20260716000001_planning_schema.sql`:

```sql
-- P1: forecast (sales/ops) -> alignment -> projection (locked) + produk baru R&D/marketing
create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  kind text not null check (kind in ('sales','ops')),
  period text not null, -- 'YYYY-Qn'
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, kind, period)
);

create table public.forecast_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  forecast_id uuid not null references public.forecasts(id) on delete cascade,
  style_id uuid not null references public.styles(id),
  qty integer not null check (qty >= 0),
  -- KPI rekomendasi ops (manual dulu; auto-hitung dari ledger = nanti)
  ito numeric(8,2),
  stock_ratio numeric(8,2),
  unique (tenant_id, forecast_id, style_id)
);
create index forecast_lines_forecast_idx on public.forecast_lines(forecast_id);

create table public.new_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  name text not null,
  style_id uuid references public.styles(id),
  rnd_status text not null default 'design' check (rnd_status in ('design','prototype','done')),
  mkt_status text not null default 'belum' check (mkt_status in ('belum','cek_ombak','tervalidasi')),
  agreed_qty integer check (agreed_qty > 0),
  notes text,
  created_at timestamptz not null default now()
);

create table public.projections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  period text not null,
  status text not null default 'draft' check (status in ('draft','locked')),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, period)
);

create table public.projection_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  projection_id uuid not null references public.projections(id) on delete cascade,
  style_id uuid not null references public.styles(id),
  qty integer not null check (qty > 0),
  kind text not null default 'regular' check (kind in ('regular','seasonal_new')),
  new_product_id uuid references public.new_products(id),
  unique (tenant_id, projection_id, style_id)
);
create index projection_lines_projection_idx on public.projection_lines(projection_id);

alter table public.forecasts enable row level security;
alter table public.forecast_lines enable row level security;
alter table public.new_products enable row level security;
alter table public.projections enable row level security;
alter table public.projection_lines enable row level security;

create policy tenant_isolation on public.forecasts for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.forecast_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.new_products for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.projections for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.projection_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.forecasts to authenticated;
grant select, insert, update, delete on public.forecast_lines to authenticated;
grant select, insert, update, delete on public.new_products to authenticated;
grant select, insert, update, delete on public.projections to authenticated;
grant select, insert, update, delete on public.projection_lines to authenticated;

-- projection locked = immutable (lines + header)
create or replace function public.guard_locked_projection() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.projections
    where id = coalesce(new.projection_id, old.projection_id);
  if v_status = 'locked' then raise exception 'projection is locked'; end if;
  return coalesce(new, old);
end;
$$;
create trigger projection_lines_lock_guard
  before insert or update or delete on public.projection_lines
  for each row execute function public.guard_locked_projection();

create or replace function public.guard_locked_projection_header() returns trigger
language plpgsql as $$
begin
  if old.status = 'locked' then raise exception 'projection is locked'; end if;
  return new;
end;
$$;
create trigger projections_lock_guard
  before update or delete on public.projections
  for each row execute function public.guard_locked_projection_header();
```

- [ ] **Step 2: Tulis migrasi fns**

`supabase/migrations/20260716000002_planning_fns.sql`:

```sql
-- create_forecast: upsert per (kind, period) — baris lama diganti (alignment bisa iterasi)
create or replace function public.create_forecast(
  p_kind text, p_period text, p_notes text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_id uuid;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_kind not in ('sales','ops') then raise exception 'kind must be sales|ops'; end if;
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
grant execute on function public.create_forecast(text, text, text, jsonb) to authenticated;

-- create_projection: hasil alignment; draft di-replace, locked ditolak (trigger guard)
create or replace function public.create_projection(
  p_period text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_id uuid;
  v_status text;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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
grant execute on function public.create_projection(text, jsonb) to authenticated;

-- lock_projection: draft -> locked (immutable). security definer: trigger guard menolak
-- update biasa; fn ini satu-satunya jalur lock.
create or replace function public.lock_projection(p_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_status text;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select status into v_status from public.projections where id = p_id and tenant_id = v_tenant for update;
  if v_status is null then raise exception 'projection not found'; end if;
  if v_status = 'locked' then raise exception 'already locked'; end if;
  if not exists (select 1 from public.projection_lines where projection_id = p_id) then
    raise exception 'projection has no lines';
  end if;
  alter table public.projections disable trigger projections_lock_guard;
  update public.projections set status = 'locked', locked_at = now() where id = p_id;
  alter table public.projections enable trigger projections_lock_guard;
end;
$$;
grant execute on function public.lock_projection(uuid) to authenticated;
```

CATATAN implementer: `alter table ... disable trigger` di dalam fn butuh table owner = definer (postgres). Kalau push gagal/permission error saat runtime, ganti pendekatan: trigger header guard hanya `before delete` + `before update` yang raise KETIKA `old.status='locked' and new.status='locked'` (izinkan transisi draft→locked), dan hapus disable/enable dari fn. Pilih yang lolos test Task 4.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716000001_planning_schema.sql supabase/migrations/20260716000002_planning_fns.sql
git commit -m "feat: P1 planning schema + fns (forecast, projection lock, new products)"
```

---

### Task 2: Migrasi P2 — PPIC (PCB + PPO)

**Files:**
- Create: `supabase/migrations/20260716000003_ppic_schema.sql`
- Create: `supabase/migrations/20260716000004_ppic_fns.sql`

**Interfaces:**
- Consumes: `projections` (harus `locked`), `styles`.
- Produces: tabel `pcb`, `pcb_lines`, `ppo`; fn `create_pcb(uuid,text,jsonb) returns uuid`, `create_ppo(uuid,uuid,text,int,text) returns uuid`.

- [ ] **Step 1: Tulis migrasi schema**

`supabase/migrations/20260716000003_ppic_schema.sql`:

```sql
-- P2 PPIC: PCB kuartalan (Production Cost Breakdown) + PPO (Parent Purchase Order)
create table public.pcb (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  quarter text not null, -- 'YYYY-Qn'
  projection_id uuid not null references public.projections(id),
  status text not null default 'draft' check (status in ('draft','final')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.pcb_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  pcb_id uuid not null references public.pcb(id) on delete cascade,
  style_id uuid not null references public.styles(id),
  target_sales integer not null check (target_sales >= 0),
  ending_stock integer not null default 0 check (ending_stock >= 0),
  -- formula SOP: total kebutuhan beli = ending stock + target sales
  supply_qty integer generated always as (ending_stock + target_sales) stored,
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  total numeric(16,2) generated always as ((ending_stock + target_sales) * unit_cost) stored,
  unique (tenant_id, pcb_id, style_id)
);
create index pcb_lines_pcb_idx on public.pcb_lines(pcb_id);

create table public.ppo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  pcb_id uuid not null references public.pcb(id),
  style_id uuid not null references public.styles(id),
  scheme text not null check (scheme in ('fob','cmt')),
  qty integer not null check (qty > 0),
  status text not null default 'draft' check (status in ('draft','issued','closed')),
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index ppo_tenant_status_idx on public.ppo(tenant_id, status);

alter table public.pcb enable row level security;
alter table public.pcb_lines enable row level security;
alter table public.ppo enable row level security;
create policy tenant_isolation on public.pcb for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.pcb_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.ppo for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.pcb to authenticated;
grant select, insert, update, delete on public.pcb_lines to authenticated;
grant select, insert, update, delete on public.ppo to authenticated;
```

- [ ] **Step 2: Tulis migrasi fns**

`supabase/migrations/20260716000004_ppic_fns.sql`:

```sql
-- create_pcb: dari projection yang sudah locked. Lines dikirim dari UI
-- (prefill target dari projection + ending stock dari stock_balances, editable).
create or replace function public.create_pcb(
  p_projection_id uuid, p_quarter text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text := 'PCB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_id uuid;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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
grant execute on function public.create_pcb(uuid, text, jsonb) to authenticated;

-- create_ppo: PPO induk per style dari PCB, pilih scheme fob|cmt
create or replace function public.create_ppo(
  p_pcb_id uuid, p_style_id uuid, p_scheme text, p_qty int, p_notes text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text := 'PPO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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
grant execute on function public.create_ppo(uuid, uuid, text, int, text) to authenticated;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716000003_ppic_schema.sql supabase/migrations/20260716000004_ppic_fns.sql
git commit -m "feat: P2 PPIC schema + fns (PCB quarterly, PPO parent order)"
```

---

### Task 3: Migrasi P3 — procurement FOB/CMT + payments

**Files:**
- Create: `supabase/migrations/20260716000005_procurement_cmt.sql`
- Create: `supabase/migrations/20260716000006_issue_ppo.sql`

**Interfaces:**
- Consumes: `ppo` (Task 2), `purchase_orders`/`purchase_lines`/`vendors`/`locations`/`materials` existing, `production_orders` existing.
- Produces: kolom `purchase_orders.ppo_id / po_type / amount`, kolom `production_orders.ppo_id`, tabel `po_payments`; fn `issue_ppo_pos(uuid, jsonb) returns void`.

- [ ] **Step 1: Tulis migrasi schema**

`supabase/migrations/20260716000005_procurement_cmt.sql`:

```sql
-- P3: PO anak ber-tipe di bawah PPO (FOB 1:1, CMT 1:N) + status pembayaran per PO.
alter table public.purchase_orders
  add column ppo_id uuid references public.ppo(id),
  add column po_type text not null default 'material'
    check (po_type in ('material','finished','sewing','bordir','accessory')),
  add column amount numeric(14,2) not null default 0 check (amount >= 0);
create index purchase_orders_ppo_idx on public.purchase_orders(ppo_id) where ppo_id is not null;

-- SPK produksi bisa ditautkan ke PPO (CMT: vendor jahit = production order existing)
alter table public.production_orders
  add column ppo_id uuid references public.ppo(id);

create table public.po_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  kind text not null check (kind in ('dp','settlement','full')),
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index po_payments_po_idx on public.po_payments(po_id);

alter table public.po_payments enable row level security;
create policy tenant_isolation on public.po_payments for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.po_payments to authenticated;
```

- [ ] **Step 2: Tulis migrasi fn issue**

`supabase/migrations/20260716000006_issue_ppo.sql`:

```sql
-- issue_ppo_pos: pecah PPO jadi PO anak.
-- FOB  -> tepat 1 anak, po_type='finished'.
-- CMT  -> >=1 anak, po_type in (material|sewing|bordir|accessory); anak material boleh
--         bawa 1 baris bahan (material_id/qty/unit_price) supaya receive existing jalan.
-- Kode anak: <kode PPO>-A, -B, -C... (SOP: PO 1A/1B/1C/1D).
create or replace function public.issue_ppo_pos(
  p_ppo_id uuid, p_children jsonb
) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
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
grant execute on function public.issue_ppo_pos(uuid, jsonb) to authenticated;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716000005_procurement_cmt.sql supabase/migrations/20260716000006_issue_ppo.sql
git commit -m "feat: P3 FOB/CMT child POs from PPO + po_payments"
```

---

### Task 4: Push migrasi + pgTAP test

**Files:**
- Create: `supabase/tests/planning.test.sql`

**Interfaces:**
- Consumes: semua fn Task 1–3.
- Produces: DB remote punya schema baru; test hijau.

- [ ] **Step 1: Tulis test**

`supabase/tests/planning.test.sql`:

```sql
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('a7777777-7777-7777-7777-777777777777','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','plan@s.test','{"tenant_name":"Plan Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='a7777777-7777-7777-7777-777777777777');
  v_style uuid;
  v_vendor uuid;
  v_mat uuid;
  v_fc uuid; v_proj uuid; v_pcb uuid; v_ppo uuid;
  v_cnt int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','a7777777-7777-7777-7777-777777777777','role','authenticated','tenant_id',v_tenant::text)::text, true);

  insert into public.styles (tenant_id, code, name) values (v_tenant, 'TST-01', 'Test Style') returning id into v_style;
  insert into public.vendors (tenant_id, name) values (v_tenant, 'Vendor Test') returning id into v_vendor;
  insert into public.materials (tenant_id, code, name, uom) values (v_tenant, 'KAIN-T', 'Kain Test', 'm') returning id into v_mat;

  -- P1: forecast + projection + lock
  v_fc := public.create_forecast('sales', '2026-Q3', null, jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 500)));
  v_proj := public.create_projection('2026-Q3', jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 450)));
  perform public.lock_projection(v_proj);

  -- locked = immutable
  begin
    update public.projection_lines set qty = 999 where projection_id = v_proj;
    raise exception 'FAIL: locked projection line was editable';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- P2: pcb (supply = ending + target) + ppo
  v_pcb := public.create_pcb(v_proj, '2026-Q3', jsonb_build_array(
    jsonb_build_object('style_id', v_style, 'target_sales', 450, 'ending_stock', 50, 'unit_cost', 100000)));
  select supply_qty into v_cnt from public.pcb_lines where pcb_id = v_pcb;
  if v_cnt <> 500 then raise exception 'supply_qty expected 500 got %', v_cnt; end if;

  -- P3 FOB: 2 anak harus ditolak, 1 anak 'finished' ok
  v_ppo := public.create_ppo(v_pcb, v_style, 'fob', 450, null);
  begin
    perform public.issue_ppo_pos(v_ppo, jsonb_build_array(
      jsonb_build_object('po_type','finished','vendor_id',v_vendor,'amount',1000),
      jsonb_build_object('po_type','finished','vendor_id',v_vendor,'amount',1000)));
    raise exception 'FAIL: FOB accepted 2 children';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform public.issue_ppo_pos(v_ppo, jsonb_build_array(
    jsonb_build_object('po_type','finished','vendor_id',v_vendor,'amount',45000000)));
  select count(*) into v_cnt from public.purchase_orders where ppo_id = v_ppo;
  if v_cnt <> 1 then raise exception 'FOB expected 1 child PO got %', v_cnt; end if;

  -- P3 CMT: 4 anak (material bawa 1 baris bahan)
  v_ppo := public.create_ppo(v_pcb, v_style, 'cmt', 450, null);
  perform public.issue_ppo_pos(v_ppo, jsonb_build_array(
    jsonb_build_object('po_type','material','vendor_id',v_vendor,'amount',9000000,'material_id',v_mat,'qty',300,'unit_price',30000),
    jsonb_build_object('po_type','sewing','vendor_id',v_vendor,'amount',6000000),
    jsonb_build_object('po_type','bordir','vendor_id',v_vendor,'amount',2000000),
    jsonb_build_object('po_type','accessory','vendor_id',v_vendor,'amount',1500000)));
  select count(*) into v_cnt from public.purchase_orders where ppo_id = v_ppo;
  if v_cnt <> 4 then raise exception 'CMT expected 4 child POs got %', v_cnt; end if;
  select count(*) into v_cnt from public.purchase_lines pl
    join public.purchase_orders po on po.id = pl.po_id where po.ppo_id = v_ppo;
  if v_cnt <> 1 then raise exception 'CMT material line expected 1 got %', v_cnt; end if;

  -- payments
  insert into public.po_payments (po_id, kind, amount)
    select id, 'dp', 3000000 from public.purchase_orders where ppo_id = v_ppo limit 1;

  reset role;
  raise notice 'planning OK: forecast->projection->lock, pcb supply calc, FOB 1:1, CMT 1:N, payments';
end $$;

rollback;
```

CATATAN implementer: cek kolom wajib `styles`/`materials` di migrasi `20260701000005_product_spine.sql` dan `20260709000002_materials.sql` sebelum insert test (mis. `uom` mungkin beda nama); sesuaikan insert test bila perlu.

- [ ] **Step 2: Push migrasi**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA"
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
npx supabase db push --db-url "$SUPABASE_DB_URL"
```
Expected: 6 migrasi baru applied tanpa error.

- [ ] **Step 3: Jalankan test**

```bash
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/planning.test.sql
```
Expected: `planning OK: ...` + `RESULT: PASS`. Kalau FAIL → perbaiki migrasi (lihat CATATAN Task 1 soal trigger), push ulang, rerun.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/planning.test.sql
git commit -m "test: pgTAP planning flow (lock guard, supply calc, FOB/CMT split)"
```

---

### Task 5: Server actions

**Files:**
- Create: `src/lib/planning/actions.ts`
- Create: `src/lib/ppic/actions.ts`

**Interfaces:**
- Consumes: fn DB Task 1–3 via `supabase.rpc`, tabel `new_products`/`po_payments` via insert/update langsung (pola `costing/actions.ts`).
- Produces (dipakai halaman Task 6–8):
  - `createForecast({kind, period, notes, lines: {style_id, qty, ito?, stock_ratio?}[]})`
  - `createProjection({period, lines: {style_id, qty, kind, new_product_id?}[]})` → redirect `/projections/<id>`
  - `lockProjection(id: string)`
  - `createNewProduct({name, style_id?, notes})`, `updateNewProduct({id, rnd_status, mkt_status, agreed_qty})`
  - `createPcb({projection_id, quarter, lines: {style_id, target_sales, ending_stock, unit_cost}[]})` → redirect `/pcb/<id>`
  - `createPpo({pcb_id, style_id, scheme, qty, notes})` → redirect `/ppo/<id>`
  - `issuePpoPos({ppo_id, children: {po_type, vendor_id, amount, notes?, material_id?, qty?, unit_price?}[]})`
  - `addPoPayment({ppo_id, po_id, kind, amount})`, `markPaymentPaid({ppo_id, payment_id})`
  - Semua return `Promise<{ error: string } | void>`.

- [ ] **Step 1: Tulis planning actions**

`src/lib/planning/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type ForecastLineInput = { style_id: string; qty: number; ito?: number | null; stock_ratio?: number | null }
export type ProjectionLineInput = { style_id: string; qty: number; kind: 'regular' | 'seasonal_new'; new_product_id?: string | null }

export async function createForecast(input: { kind: 'sales' | 'ops'; period: string; notes: string; lines: ForecastLineInput[] }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('create_forecast', {
    p_kind: input.kind, p_period: input.period, p_notes: input.notes, p_lines: input.lines,
  })
  if (error) return { error: error.message }
  revalidatePath('/forecasts')
  revalidatePath('/projections')
}

export async function createProjection(input: { period: string; lines: ProjectionLineInput[] }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_projection', { p_period: input.period, p_lines: input.lines })
  if (error) return { error: error.message }
  redirect(`/projections/${data}`)
}

export async function lockProjection(id: string): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('lock_projection', { p_id: id })
  if (error) return { error: error.message }
  revalidatePath(`/projections/${id}`)
  revalidatePath('/projections')
}

export async function createNewProduct(input: { name: string; style_id?: string; notes: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('new_products').insert({
    name: input.name, style_id: input.style_id || null, notes: input.notes || null,
  })
  if (error) return { error: error.message }
  revalidatePath('/new-products')
}

export async function updateNewProduct(input: { id: string; rnd_status: string; mkt_status: string; agreed_qty: number | null }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('new_products').update({
    rnd_status: input.rnd_status, mkt_status: input.mkt_status, agreed_qty: input.agreed_qty,
  }).eq('id', input.id)
  if (error) return { error: error.message }
  revalidatePath('/new-products')
  revalidatePath('/projections')
}
```

- [ ] **Step 2: Tulis ppic actions**

`src/lib/ppic/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type PcbLineInput = { style_id: string; target_sales: number; ending_stock: number; unit_cost: number }
export type PpoChildInput = {
  po_type: 'material' | 'finished' | 'sewing' | 'bordir' | 'accessory'
  vendor_id: string; amount: number; notes?: string
  material_id?: string; qty?: number; unit_price?: number
}

export async function createPcb(input: { projection_id: string; quarter: string; lines: PcbLineInput[] }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_pcb', {
    p_projection_id: input.projection_id, p_quarter: input.quarter, p_lines: input.lines,
  })
  if (error) return { error: error.message }
  redirect(`/pcb/${data}`)
}

export async function createPpo(input: { pcb_id: string; style_id: string; scheme: 'fob' | 'cmt'; qty: number; notes: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_ppo', {
    p_pcb_id: input.pcb_id, p_style_id: input.style_id, p_scheme: input.scheme, p_qty: input.qty, p_notes: input.notes,
  })
  if (error) return { error: error.message }
  redirect(`/ppo/${data}`)
}

export async function issuePpoPos(input: { ppo_id: string; children: PpoChildInput[] }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('issue_ppo_pos', { p_ppo_id: input.ppo_id, p_children: input.children })
  if (error) return { error: error.message }
  revalidatePath(`/ppo/${input.ppo_id}`)
  revalidatePath('/ppo')
  revalidatePath('/purchasing')
}

export async function addPoPayment(input: { ppo_id: string; po_id: string; kind: 'dp' | 'settlement' | 'full'; amount: number }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('po_payments').insert({ po_id: input.po_id, kind: input.kind, amount: input.amount })
  if (error) return { error: error.message }
  revalidatePath(`/ppo/${input.ppo_id}`)
}

export async function markPaymentPaid(input: { ppo_id: string; payment_id: string }): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase.from('po_payments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', input.payment_id)
  if (error) return { error: error.message }
  revalidatePath(`/ppo/${input.ppo_id}`)
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/planning/actions.ts src/lib/ppic/actions.ts
git commit -m "feat: planning + ppic server actions"
```
Expected tsc: tanpa error baru.

---

### Task 6: Halaman P1 — /forecasts, /projections, /new-products

**Files:**
- Create: `src/app/(app)/forecasts/page.tsx`, `src/app/(app)/forecasts/ForecastForm.tsx`
- Create: `src/app/(app)/projections/page.tsx`, `src/app/(app)/projections/AlignmentForm.tsx`
- Create: `src/app/(app)/projections/[id]/page.tsx`, `src/app/(app)/projections/[id]/LockButton.tsx`
- Create: `src/app/(app)/new-products/page.tsx`, `src/app/(app)/new-products/NewProductForm.tsx`, `src/app/(app)/new-products/NewProductRow.tsx`

**Interfaces:**
- Consumes: actions Task 5; tabel `forecasts/forecast_lines/projections/projection_lines/new_products/styles` (select langsung di server component, pola `purchasing/page.tsx`).
- Produces: route `/forecasts`, `/projections`, `/projections/[id]`, `/new-products`.

Pola wajib (ikuti `purchasing/page.tsx` + `PurchaseForm.tsx`): page = server component async, ambil data via `createClient()` dari `@/lib/supabase/server`, layout grid `1.4fr 1fr` (list kiri, form kanan), form = client component dengan `useState` rows + tombol `+ Baris`, error banner `vb-danger`, tombol saving-disabled.

- [ ] **Step 1: /forecasts**

`page.tsx`: query `forecasts` (order period desc, kind), `forecast_lines`, `styles` aktif. List kiri: satu baris per forecast — kolom Period, Jenis (badge: `sales`→'Sales', `ops`→'Operasional'), jumlah baris, total qty. Kanan: `<ForecastForm styles={styles}/>`.

`ForecastForm.tsx` (client): state `kind` ('sales'|'ops' select), `period` (input text placeholder `2026-Q3`), `notes`, `rows: {style_id, qty, ito, stock_ratio}[]`. Kolom ITO & Stock Ratio hanya render kalau `kind==='ops'`. Validasi: period regex `/^\d{4}-Q[1-4]$/`, minimal 1 baris qty>0. Submit → `createForecast({...})`; sukses → reset form (action sudah revalidate).

- [ ] **Step 2: /projections (alignment + list)**

`page.tsx`: query `projections` + `projection_lines`, `forecasts` + `forecast_lines`, `styles`, `new_products` where `mkt_status='tervalidasi' and agreed_qty is not null and style_id is not null`. Kiri: list projection (Period, status badge `draft`→'Draft' kuning / `locked`→'Terkunci' hijau, total qty, link `/projections/[id]`). Kanan: `<AlignmentForm periods={...} styles={...} newProducts={...}/>` — kirim struktur `{period, salesByStyle: Record<styleId, qty>, opsByStyle: Record<styleId, qty>}[]` yang dihitung di server component dari forecast_lines.

`AlignmentForm.tsx` (client): select `period` dari periods yang punya minimal 1 forecast. Setelah pilih period, render tabel per style (union style yang muncul di sales/ops): kolom `Style | Sales | Ops | Final (input)` — default nilai Final = qty ops kalau ada, else sales. Section kedua "Produk Baru (seasonal)": checkbox per new_product tervalidasi, qty default `agreed_qty`, editable. Submit → `createProjection({period, lines})` dengan lines regular (`kind:'regular'`) + seasonal (`kind:'seasonal_new'`, `new_product_id`). Redirect otomatis dari action.

- [ ] **Step 3: /projections/[id] + lock**

`page.tsx` (`{ params }: { params: Promise<{ id: string }> }` — cek pola params di `src/app/(app)/purchasing/[id]/page.tsx` dan ikuti persis). Query projection + lines + styles + new_products (nama). Render: header period + status badge, tabel lines (Style, Qty, Jenis regular/seasonal-baru), kalau `status==='draft'` → `<LockButton id={...}/>`, kalau locked → link `vb-btn` "Buat PCB dari proyeksi ini →" ke `/pcb/new?projection=<id>`.

`LockButton.tsx` (client): tombol konfirmasi 2 langkah (klik 1 → teks "Yakin kunci? Klik lagi", klik 2 → `lockProjection(id)`); tampilkan error kalau ada.

- [ ] **Step 4: /new-products**

`page.tsx`: query `new_products` + `styles`. Kiri list: tiap baris render `<NewProductRow p={...}/>`. Kanan: `<NewProductForm styles={...}/>`.

`NewProductForm.tsx` (client): input name, select style (opsional, "Belum ada style"), notes → `createNewProduct`.

`NewProductRow.tsx` (client): tampil nama + 2 select inline (`rnd_status`: design/prototype/done label 'Desain/Prototipe/Selesai'; `mkt_status`: belum/cek_ombak/tervalidasi label 'Belum/Cek Ombak/Tervalidasi') + input `agreed_qty` + tombol Simpan → `updateNewProduct`. Badge hijau "Siap masuk proyeksi" kalau tervalidasi + agreed_qty + style_id terisi.

- [ ] **Step 5: Verifikasi + commit**

```bash
npx tsc --noEmit && npx next lint --dir src/app/\(app\)/forecasts --dir src/app/\(app\)/projections --dir src/app/\(app\)/new-products 2>/dev/null || npx tsc --noEmit
git add "src/app/(app)/forecasts" "src/app/(app)/projections" "src/app/(app)/new-products"
git commit -m "feat: P1 UI (forecast input, alignment->projection lock, produk baru)"
```

---

### Task 7: Halaman P2 — /pcb

**Files:**
- Create: `src/app/(app)/pcb/page.tsx`
- Create: `src/app/(app)/pcb/new/page.tsx`, `src/app/(app)/pcb/new/PcbForm.tsx`
- Create: `src/app/(app)/pcb/[id]/page.tsx`, `src/app/(app)/pcb/[id]/PpoForm.tsx`

**Interfaces:**
- Consumes: `createPcb`, `createPpo` (Task 5); tabel `pcb/pcb_lines/projections/projection_lines/styles/ppo`; view `stock_balances` + tabel `skus` (agregasi stok per style).
- Produces: route `/pcb`, `/pcb/new?projection=<id>`, `/pcb/[id]`.

- [ ] **Step 1: /pcb list**

`page.tsx`: query `pcb` order created_at desc + `pcb_lines` (hitung total nilai per pcb = sum(total)). Kolom: Kode, Kuartal, Jumlah Style, Total Nilai (format `Intl.NumberFormat('id-ID')`), link `/pcb/[id]`. Header + tombol link "Buat PCB" ke `/projections` (PCB dibuat dari projection locked). Empty state: "Belum ada PCB. Buat dari proyeksi yang sudah terkunci."

- [ ] **Step 2: /pcb/new?projection=id (prefill)**

`page.tsx` server: baca `searchParams` (Promise di Next versi repo ini — cek pola di halaman existing yang pakai searchParams; kalau tidak ada contoh, `const { projection } = await searchParams`). Query projection (harus locked, kalau tidak render pesan + link balik), lines + styles. Prefill ending_stock per style: query `skus` (id, style_id) + `stock_balances` (sku_id, balance) → jumlahkan balance per style di server. Prefill unit_cost: 0 (user isi; HPP dari `sku_hpp` per-sku, per-style belum ada — jangan dipaksakan). Render `<PcbForm projectionId quarter={projection.period} rows={prefill}/>`.

`PcbForm.tsx` (client): quarter input (default period projection), tabel rows per style: `Style | Target Sales (prefill qty projection) | Ending Stock (prefill stok) | Biaya/unit | Kebutuhan (target+ending, computed tampilan) | Subtotal`. Footer: total nilai. Submit → `createPcb`.

- [ ] **Step 3: /pcb/[id] + buat PPO**

`page.tsx`: query pcb + lines + styles + `ppo` where pcb_id. Render: header (kode, kuartal, badge status), tabel lines dengan kolom `Style | Target | End Stock | Kebutuhan | Biaya/unit | Subtotal`, footer roll-up total kuartalan (ini "budget/expenditure roll-up" dari spec). Section bawah: daftar PPO yang sudah dibuat dari PCB ini (kode, style, scheme badge FOB biru/CMT oranye, qty, status, link `/ppo/[id]`) + `<PpoForm pcbId lines={...}/>`.

`PpoForm.tsx` (client): select style (dari pcb lines), select scheme (`fob` label 'FOB — beli jadi 1 vendor', `cmt` label 'CMT — pecah per proses'), qty (default supply_qty line terpilih), notes → `createPpo`.

- [ ] **Step 4: Verifikasi + commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/pcb"
git commit -m "feat: P2 UI (PCB quarterly dari projection, roll-up, buat PPO)"
```

---

### Task 8: Halaman P3 — /ppo + pecah PO + pembayaran

**Files:**
- Create: `src/app/(app)/ppo/page.tsx`
- Create: `src/app/(app)/ppo/[id]/page.tsx`, `src/app/(app)/ppo/[id]/IssueForm.tsx`, `src/app/(app)/ppo/[id]/PaymentPanel.tsx`

**Interfaces:**
- Consumes: `issuePpoPos`, `addPoPayment`, `markPaymentPaid` (Task 5); tabel `ppo/pcb/purchase_orders/purchase_lines/po_payments/vendors/materials/styles`.
- Produces: route `/ppo`, `/ppo/[id]`.

Label tipe PO (konsisten di semua render): `finished`→'Barang Jadi', `material`→'Bahan', `sewing`→'Jahit', `bordir`→'Bordir', `accessory`→'Aksesoris'.

- [ ] **Step 1: /ppo list**

`page.tsx`: query `ppo` + `styles` + count anak (`purchase_orders` where ppo_id). Kolom: Kode, Style, Skema (badge FOB/CMT), Qty, Anak PO (n), Status (draft 'Draft'/issued 'Terbit'/closed 'Selesai'), link detail.

- [ ] **Step 2: /ppo/[id] detail**

`page.tsx`: query ppo, style, pcb (kode → link balik), anak: `purchase_orders` where `ppo_id` + `purchase_lines` + `po_payments` per anak + `vendors` + `materials` aktif. Render:
- Header: kode PPO, style, badge scheme, qty, status, link "← PCB <kode>".
- Kalau `status==='draft'`: `<IssueForm ppoId scheme vendors materials/>`.
- Kalau sudah issued: tabel anak PO — kolom `Kode | Tipe | Vendor | Nilai | Approval (doc_status: 'Draft'/'ACC') | Pembayaran`; kode anak link ke `/purchasing/[id]` KHUSUS `po_type==='material'` (halaman itu render lines bahan; tipe jasa cukup teks). Kolom Pembayaran render `<PaymentPanel ppoId po={...} payments={...}/>`.
- Baris info CMT: "Bahan di-PO terpisah → terima di Pembelian; jahit = SPK Produksi" + link `/production/new` (colok ke SPK existing).

`IssueForm.tsx` (client): rows `{po_type, vendor_id, amount, notes, material_id, qty, unit_price}`.
- `scheme==='fob'`: fixed 1 row, po_type terkunci 'finished'.
- `scheme==='cmt'`: default 4 rows preset type material/sewing/bordir/accessory, boleh tambah/hapus (min 1); row `po_type==='material'` render field tambahan select bahan + qty + harga (opsional — boleh kosong, PO bahan detail bisa lewat /purchasing).
- Validasi: tiap row wajib vendor; amount ≥ 0 angka. Submit → `issuePpoPos`. Sukses → form hilang (revalidate menampilkan tabel anak).

`PaymentPanel.tsx` (client): daftar payment (kind label 'DP'/'Pelunasan'/'Penuh', amount id-ID, badge 'Belum Bayar' kuning /'Lunas' hijau, tombol "Tandai Lunas" kalau pending → `markPaymentPaid`). Form tambah: select kind + amount → `addPoPayment`. FOB hint: tampilkan urutan "DP → Barang → Pelunasan" sebagai teks kecil `vb-muted`.

- [ ] **Step 3: Verifikasi + commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/ppo"
git commit -m "feat: P3 UI (PPO detail, pecah PO FOB/CMT, status pembayaran)"
```

---

### Task 9: SideNav

**Files:**
- Modify: `src/components/SideNav.tsx:8-9` (array `GROUPS`)

**Interfaces:**
- Produces: navigasi ke semua route baru.

- [ ] **Step 1: Sisipkan 2 grup setelah Dashboard**

Di `GROUPS`, sisipkan setelah elemen `{ items: [{ label: 'Dashboard', href: '/' }] }`:

```ts
  { title: 'Perencanaan', items: [{ label: 'Forecast', href: '/forecasts' }, { label: 'Proyeksi', href: '/projections' }, { label: 'Produk Baru', href: '/new-products' }] },
  { title: 'PPIC', items: [{ label: 'PCB', href: '/pcb' }, { label: 'PPO', href: '/ppo' }] },
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit
git add src/components/SideNav.tsx
git commit -m "feat: sidebar groups Perencanaan + PPIC"
```

---

### Task 10: Seeder demo

**Files:**
- Modify: `scripts/seed-demo.mjs` (array wipe + section baru sebelum `commit`)

**Interfaces:**
- Consumes: tabel Task 1–3; style/vendor/material ids yang sudah dibuat seeder existing (pakai variabel yang ada di script — baca script dulu, jangan tebak nama variabel).
- Produces: data demo alur penuh P1→P3 untuk tenant demo.

- [ ] **Step 1: Update array wipe**

Ganti array wipe existing jadi (urutan FK-safe — `po_payments` sebelum `purchase_orders`; `ppo` setelah `purchase_orders` & `production_orders`; `pcb` setelah `ppo`; `projections` setelah `pcb`):

```js
  for (const t of [
    'return_lines', 'returns', 'order_lines', 'orders',
    'cost_entries', 'prod_lines', 'production_orders',
    'po_payments', 'purchase_lines', 'purchase_orders',
    'ppo', 'pcb_lines', 'pcb',
    'projection_lines', 'projections', 'new_products',
    'forecast_lines', 'forecasts',
    'bom_lines', 'material_ledger', 'stock_ledger',
    'skus', 'colorways', 'styles', 'materials', 'channels', 'vendors',
  ]) await c.query(`delete from ${t} where tenant_id = $1`, [T]);
```

- [ ] **Step 2: Tambah section planning sebelum `await c.query('commit')`**

Seeder jalan sebagai postgres (bukan JWT) → insert langsung, `tenant_id` eksplisit, TANPA rpc. Ambil 2 style id + 1 vendor + 1 material dari variabel yang sudah ada di script (baca bagian styles/vendors/materials-nya; kalau variabelnya tidak jelas, query: `select id from styles where tenant_id=$1 order by created_at limit 2`). Kerangka (sesuaikan nama variabel):

```js
  // --- P1-P3: forecast -> projection -> PCB -> PPO -> child POs ------------
  const Q = '2026-Q3';
  const [STY_A, STY_B] = (await c.query(
    `select id from styles where tenant_id=$1 order by created_at limit 2`, [T])).rows.map(r => r.id);
  const VEND = (await c.query(`select id from vendors where tenant_id=$1 limit 1`, [T])).rows[0].id;
  const MAT = (await c.query(`select id from materials where tenant_id=$1 limit 1`, [T])).rows[0].id;

  const fcS = await ins(`insert into forecasts(tenant_id,kind,period) values($1,'sales',$2) returning id`, [T, Q]);
  const fcO = await ins(`insert into forecasts(tenant_id,kind,period,notes) values($1,'ops',$2,'Rekomendasi ITO 4x') returning id`, [T, Q]);
  await c.query(`insert into forecast_lines(tenant_id,forecast_id,style_id,qty) values($1,$2,$3,520),($1,$2,$4,340)`, [T, fcS, STY_A, STY_B]);
  await c.query(`insert into forecast_lines(tenant_id,forecast_id,style_id,qty,ito,stock_ratio) values($1,$2,$3,450,4.2,1.15),($1,$2,$4,300,3.8,1.20)`, [T, fcO, STY_A, STY_B]);

  const NP = await ins(
    `insert into new_products(tenant_id,name,style_id,rnd_status,mkt_status,agreed_qty,notes)
     values($1,'Raya Capsule 2026',$2,'done','tervalidasi',200,'Cek ombak IG: 200 pcs aman') returning id`, [T, STY_B]);

  const PROJ = await ins(`insert into projections(tenant_id,period,status,locked_at) values($1,$2,'locked',now()) returning id`, [T, Q]);
  // NB: trigger lock-guard menolak insert lines saat parent locked -> disable dulu (postgres owner)
  await c.query(`alter table projection_lines disable trigger projection_lines_lock_guard`);
  await c.query(
    `insert into projection_lines(tenant_id,projection_id,style_id,qty,kind,new_product_id)
     values($1,$2,$3,450,'regular',null),($1,$2,$4,200,'seasonal_new',$5)`, [T, PROJ, STY_A, STY_B, NP]);
  await c.query(`alter table projection_lines enable trigger projection_lines_lock_guard`);

  const PCB = await ins(`insert into pcb(tenant_id,code,quarter,projection_id) values($1,'PCB-2026Q3',$2,$3) returning id`, [T, Q, PROJ]);
  await c.query(
    `insert into pcb_lines(tenant_id,pcb_id,style_id,target_sales,ending_stock,unit_cost)
     values($1,$2,$3,450,60,165000),($1,$2,$4,200,0,120000)`, [T, PCB, STY_A, STY_B]);

  // PPO 2 (FOB) -> 1 anak finished, DP lunas + pelunasan pending
  const PPO_FOB = await ins(`insert into ppo(tenant_id,code,pcb_id,style_id,scheme,qty,status) values($1,'PPO-2',$2,$3,'fob',510,'issued') returning id`, [T, PCB, STY_A]);
  const POF = await ins(
    `insert into purchase_orders(tenant_id,code,vendor_id,location_id,ppo_id,po_type,amount,doc_status,approved_at)
     values($1,'PPO-2-A',$2,$3,$4,'finished',84150000,'approved',now()) returning id`, [T, VEND, LOC_MAIN, PPO_FOB]);
  await c.query(`insert into po_payments(tenant_id,po_id,kind,amount,status,paid_at) values($1,$2,'dp',25000000,'paid',now())`, [T, POF]);
  await c.query(`insert into po_payments(tenant_id,po_id,kind,amount) values($1,$2,'settlement',59150000)`, [T, POF]);

  // PPO 1 (CMT) -> 4 anak (SOP: 1A bahan, 1B jahit, 1C bordir, 1D aksesoris)
  const PPO_CMT = await ins(`insert into ppo(tenant_id,code,pcb_id,style_id,scheme,qty,status) values($1,'PPO-1',$2,$3,'cmt',200,'issued') returning id`, [T, PCB, STY_B]);
  const kinds = [['A','material',9000000],['B','sewing',6000000],['C','bordir',2000000],['D','accessory',1500000]];
  for (const [sfx, typ, amt] of kinds) {
    const pid = await ins(
      `insert into purchase_orders(tenant_id,code,vendor_id,location_id,ppo_id,po_type,amount)
       values($1,$2,$3,$4,$5,$6,$7) returning id`, [T, `PPO-1-${sfx}`, VEND, LOC_MAIN, PPO_CMT, typ, amt]);
    if (typ === 'material')
      await c.query(`insert into purchase_lines(tenant_id,po_id,material_id,qty_ordered,unit_price) values($1,$2,$3,300,30000)`, [T, pid, MAT]);
    await c.query(`insert into po_payments(tenant_id,po_id,kind,amount) values($1,$2,'full',$3)`, [T, pid, amt]);
  }
```

CATATAN: `LOC_MAIN` sudah ada di script. Tambahkan tabel baru ke daftar `counts` summary di akhir: `'forecasts','projections','pcb','ppo','po_payments'`.

- [ ] **Step 3: Jalankan seeder**

```bash
cd "/Users/rezanje/Gen_Dev_Studio/ERP VOBIA" && node scripts/seed-demo.mjs
```
Expected: `seeded: {...}` termasuk forecasts: '2', projections: '1', pcb: '1', ppo: '2', po_payments: '6'. Error → fix, rerun (idempotent).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-demo.mjs
git commit -m "feat: seed demo alur P1-P3 (forecast->projection->PCB->PPO FOB+CMT)"
```

---

### Task 11: Verifikasi E2E demo-walkthrough

**Files:** tidak ada (verifikasi runtime).

- [ ] **Step 1: Start dev server** via preview tool (`.claude/launch.json`, port 3100) — JANGAN `npm run dev` via Bash.

- [ ] **Step 2: Login sebagai user demo**, klik alur penuh persis urutan demo besok:
1. `/forecasts` — 2 forecast (Sales & Ops) 2026-Q3 tampil; buat 1 forecast baru period 2026-Q4 → muncul.
2. `/projections` — proyeksi 2026-Q3 status Terkunci; alignment form: pilih 2026-Q4 → tabel sales vs ops muncul → isi final → simpan → redirect detail draft → kunci → badge Terkunci.
3. `/new-products` — 'Raya Capsule 2026' badge siap; ubah status → tersimpan.
4. `/pcb` — PCB-2026Q3 tampil dengan total nilai; buka detail → roll-up benar (450+60)×165000 + (200+0)×120000 = Rp 111.150.000.
5. Dari projection 2026-Q4 (locked) → Buat PCB → prefill target & stok → simpan → detail.
6. `/ppo` — PPO-1 (CMT, 4 anak) & PPO-2 (FOB, 1 anak). Detail PPO-2: anak PPO-2-A ACC, DP Lunas, Pelunasan Belum → klik "Tandai Lunas" → hijau.
7. Detail PPO-1: 4 anak (Bahan/Jahit/Bordir/Aksesoris); PPO-1-A link ke `/purchasing/[id]` dan bisa diterima (approval dulu via flow ACC existing — buktikan gate jalan).
8. Buat PPO baru dari PCB 2026-Q4 → scheme CMT → IssueForm 4 baris preset → terbit → anak muncul + tambah pembayaran.
9. `/purchasing` — anak PO material ikut muncul di list existing (integrasi hilir OK).

- [ ] **Step 3: Cek console + server log** via preview tools (read_console_messages, preview_logs) — tidak ada error merah.

- [ ] **Step 4: Jalankan ulang seluruh pgTAP suite** (regresi):

```bash
export SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)"
SUPABASE_DB_URL="$SUPABASE_DB_URL" node scripts/pgtap.mjs supabase/tests/*.test.sql
```
Expected: `RESULT: PASS`.

- [ ] **Step 5: Commit akhir**

```bash
git add -A && git commit -m "feat: manufacturing upstream P1-P3 demo-walkable (forecast->PPIC->FOB/CMT)"
```
