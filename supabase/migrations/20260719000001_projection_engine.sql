-- Projection engine: replika mesin sheet "2026 Projection Vobia", tapi aktualnya
-- diambil dari stock_ledger (bukan diketik ulang).
--
-- Yang diketik manusia hanya SATU: demand_plan (forecast Sales QTY per SKU per bulan).
-- Stok awal / barang masuk / stok akhir / semua nilai rupiah = dihitung.
--
-- Asumsi client yang di sheet jadi konstanta di dalam rumus, di sini jadi parameter
-- per tenant (planning_params) supaya bisa diubah tanpa ganti kode:
--   cover_months 1.5  -- stok awal bulan X ditarget 1.5x forecast penjualan bulan X
--   selling_days 27   -- hari jualan efektif per bulan (dipakai run-rate)
--   net_rate     0.95 -- Sales Net = Sales Gross x 95%
-- Angka default = yang terbaca dari sheet client per Juli 2026; BELUM dikonfirmasi.

create table public.planning_params (
  tenant_id uuid primary key default (auth.jwt() ->> 'tenant_id')::uuid
    references public.tenants(id),
  cover_months numeric(4,2) not null default 1.5 check (cover_months > 0 and cover_months <= 12),
  selling_days integer      not null default 27  check (selling_days between 1 and 31),
  net_rate     numeric(5,4) not null default 0.95 check (net_rate > 0 and net_rate <= 1),
  updated_at   timestamptz  not null default now()
);

-- Forecast penjualan per SKU per bulan. Satu-satunya input manual.
-- month selalu tanggal 1 (bucket bulanan), dijaga constraint.
create table public.demand_plan (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid
    references public.tenants(id),
  sku_id uuid not null references public.skus(id),
  month date not null,
  qty integer not null check (qty >= 0),
  -- 'runrate' = hasil seed otomatis, 'manual' = sudah disentuh manusia
  source text not null default 'manual' check (source in ('manual','runrate')),
  updated_at timestamptz not null default now(),
  constraint demand_plan_month_is_first_day check (month = date_trunc('month', month)::date),
  unique (tenant_id, sku_id, month)
);
create index demand_plan_month_idx on public.demand_plan(tenant_id, month);

alter table public.planning_params enable row level security;
alter table public.demand_plan enable row level security;

create policy tenant_isolation on public.planning_params for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.demand_plan for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Sesuai idiom modul lain: fn adalah satu-satunya jalur tulis, guard role ada di fn.
grant select on public.planning_params to authenticated;
grant select on public.demand_plan to authenticated;
revoke insert, update, delete on public.planning_params from authenticated;
revoke insert, update, delete on public.demand_plan from authenticated;


-- ---------------------------------------------------------------------------
-- set_planning_params: owner saja. Mengubah asumsi = mengubah semua angka
-- proyeksi, jadi tidak diserahkan ke role operasional.
-- ---------------------------------------------------------------------------
create or replace function public.set_planning_params(
  p_cover_months numeric, p_selling_days integer, p_net_rate numeric
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role <> 'owner', true) then
    raise exception 'hanya Owner yang boleh mengubah asumsi perencanaan';
  end if;

  insert into public.planning_params (tenant_id, cover_months, selling_days, net_rate)
  values (v_tenant, p_cover_months, p_selling_days, p_net_rate)
  on conflict (tenant_id) do update
    set cover_months = excluded.cover_months,
        selling_days = excluded.selling_days,
        net_rate     = excluded.net_rate,
        updated_at   = now();
end;
$$;
grant execute on function public.set_planning_params(numeric, integer, numeric) to authenticated;


-- ---------------------------------------------------------------------------
-- set_demand_plan: upsert forecast penjualan. Sales yang punya angka permintaan.
-- p_lines = [{"sku_id": uuid, "month": "2026-08-01", "qty": 120}, ...]
-- ---------------------------------------------------------------------------
create or replace function public.set_demand_plan(p_lines jsonb) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_line jsonb;
  v_sku uuid;
  v_month date;
  v_qty integer;
  v_n integer := 0;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','sales'), true) then
    raise exception 'hanya role Sales/Owner yang boleh input forecast penjualan';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then
    raise exception 'at least one line required';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_sku   := (v_line ->> 'sku_id')::uuid;
    v_month := date_trunc('month', (v_line ->> 'month')::date)::date;
    v_qty   := (v_line ->> 'qty')::integer;

    if v_qty is null or v_qty < 0 then raise exception 'qty must be >= 0'; end if;
    if not exists (select 1 from public.skus where id = v_sku and tenant_id = v_tenant) then
      raise exception 'sku not in tenant';
    end if;

    insert into public.demand_plan (tenant_id, sku_id, month, qty, source)
    values (v_tenant, v_sku, v_month, v_qty, 'manual')
    on conflict (tenant_id, sku_id, month) do update
      set qty = excluded.qty, source = 'manual', updated_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
grant execute on function public.set_demand_plan(jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- seed_demand_plan: isi awal forecast dari run-rate penjualan aktual.
--   qty = (penjualan p_lookback_days hari terakhir / p_lookback_days) * selling_days
-- Ini yang menggantikan ~1.500 sel ketik-tangan di sheet. Baris yang sudah
-- disentuh manusia (source='manual') TIDAK ditimpa.
-- ---------------------------------------------------------------------------
create or replace function public.seed_demand_plan(
  p_from date, p_months integer default 6, p_lookback_days integer default 90
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_selling_days integer;
  v_n integer;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','sales'), true) then
    raise exception 'hanya role Sales/Owner yang boleh mengisi forecast penjualan';
  end if;
  if p_from <> date_trunc('month', p_from)::date then
    raise exception 'p_from harus tanggal 1';
  end if;
  if p_months < 1 or p_months > 24 then raise exception 'p_months harus 1..24'; end if;
  if p_lookback_days < 7 then raise exception 'p_lookback_days minimal 7'; end if;

  select coalesce(max(pp.selling_days), 27) into v_selling_days
    from public.planning_params pp where pp.tenant_id = v_tenant;

  with runrate as (
    select k.id as sku_id,
           -- sale_out disimpan negatif oleh record_movement
           round(
             coalesce(-sum(l.qty), 0)::numeric / p_lookback_days * v_selling_days
           )::integer as qty
    from public.skus k
    left join public.stock_ledger l
      on l.sku_id = k.id
     and l.tenant_id = v_tenant
     and l.movement_type = 'sale_out'
     and l.created_at >= now() - make_interval(days => p_lookback_days)
    where k.tenant_id = v_tenant and k.active
    group by k.id
  ),
  months as (
    select (p_from + make_interval(months => g))::date as month
    from generate_series(0, p_months - 1) g
  ),
  upserted as (
    insert into public.demand_plan as dp (tenant_id, sku_id, month, qty, source)
    select v_tenant, r.sku_id, m.month, r.qty, 'runrate'
    from runrate r cross join months m
    on conflict (tenant_id, sku_id, month) do update
      set qty = excluded.qty, updated_at = now()
      where dp.source = 'runrate'   -- jangan timpa input manusia
    returning 1
  )
  select count(*) into v_n from upserted;
  return v_n;
end;
$$;
grant execute on function public.seed_demand_plan(date, integer, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- project_stock: mesin utamanya. Setara blok 14 kolom per bulan di sheet.
--
--   beginning = ending bulan lalu + incoming
--   incoming  = max(0, ceil(sales * cover_months) - ending bulan lalu)
--   ending    = beginning - sales           (negatif = diproyeksi kehabisan stok)
--
-- Stok awal bulan pertama = saldo stock_ledger saat ini (aktual, bukan ketikan).
-- Loop per bulan, set-based per SKU: 12 iterasi, bukan 683x12.
-- ---------------------------------------------------------------------------
create or replace function public.project_stock(p_from date, p_months integer default 6)
returns table (
  sku_id uuid,
  sku_code text,
  month date,
  beginning_qty integer,
  incoming_qty integer,
  sales_qty integer,
  ending_qty integer,
  incoming_cogs numeric,
  incoming_gross numeric,
  beginning_cogs numeric,
  beginning_gross numeric,
  sales_cogs numeric,
  sales_gross numeric,
  sales_net numeric,
  ending_cogs numeric,
  ending_gross numeric,
  cover_ratio numeric
)
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_cover numeric;
  v_net numeric;
  v_i integer;
  v_month date;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_from <> date_trunc('month', p_from)::date then
    raise exception 'p_from harus tanggal 1';
  end if;
  if p_months < 1 or p_months > 24 then raise exception 'p_months harus 1..24'; end if;

  select coalesce(max(pp.cover_months), 1.5), coalesce(max(pp.net_rate), 0.95)
    into v_cover, v_net
    from public.planning_params pp where pp.tenant_id = v_tenant;

  drop table if exists _roll;
  create temp table _roll (
    sku_id uuid primary key,
    carry integer not null          -- stok akhir bulan sebelumnya
  ) on commit drop;

  drop table if exists _out;
  create temp table _out (
    sku_id uuid,
    month date,
    beginning integer,
    incoming integer,
    sales integer,
    ending integer
  ) on commit drop;

  -- posisi awal = saldo ledger hari ini
  insert into _roll (sku_id, carry)
  select k.id, coalesce(b.balance, 0)
  from public.skus k
  left join public.stock_balances b on b.sku_id = k.id and b.tenant_id = v_tenant
  where k.tenant_id = v_tenant and k.active;

  for v_i in 0 .. p_months - 1 loop
    v_month := (p_from + make_interval(months => v_i))::date;

    insert into _out (sku_id, month, beginning, incoming, sales, ending)
    select r.sku_id,
           v_month,
           r.carry + inc.v,
           inc.v,
           d.qty,
           r.carry + inc.v - d.qty
    from _roll r
    cross join lateral (
      select coalesce((
        select dp.qty from public.demand_plan dp
        where dp.tenant_id = v_tenant and dp.sku_id = r.sku_id and dp.month = v_month
      ), 0) as qty
    ) d
    cross join lateral (
      select greatest(0, ceil(d.qty * v_cover)::integer - r.carry) as v
    ) inc;

    update _roll r
      set carry = o.ending
      from _out o
     where o.sku_id = r.sku_id and o.month = v_month;
  end loop;

  return query
  select o.sku_id,
         k.sku_code,
         o.month,
         o.beginning,
         o.incoming,
         o.sales,
         o.ending,
         -- SKU tanpa harga master dihitung 0, bukan NULL, supaya total tetap terjumlah
         o.incoming  * coalesce(k.cogs, 0),
         o.incoming  * coalesce(k.retail_price, 0),
         o.beginning * coalesce(k.cogs, 0),
         o.beginning * coalesce(k.retail_price, 0),
         o.sales     * coalesce(k.cogs, 0),
         o.sales     * coalesce(k.retail_price, 0),
         o.sales     * coalesce(k.retail_price, 0) * v_net,
         o.ending    * coalesce(k.cogs, 0),
         o.ending    * coalesce(k.retail_price, 0),
         round(o.beginning::numeric / nullif(o.sales, 0), 2)
  from _out o
  join public.skus k on k.id = o.sku_id
  order by k.sku_code, o.month;
end;
$$;
grant execute on function public.project_stock(date, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- projection_summary: setara tab "Summary" di sheet — KPI per bulan, se-brand.
-- ITO memakai persediaan rata-rata (awal + akhir)/2 seperti rumus client,
-- tapi per bulan (bukan YTD) supaya tidak bergantung saldo tahun lalu.
-- ---------------------------------------------------------------------------
create or replace function public.projection_summary(p_from date, p_months integer default 6)
returns table (
  month date,
  incoming_cogs numeric,
  incoming_gross numeric,
  beginning_gross numeric,
  sales_gross numeric,
  sales_net numeric,
  sales_cogs numeric,
  ending_gross numeric,
  ending_cogs numeric,
  stock_ratio numeric,
  ito numeric,
  gpm numeric,
  margin numeric,
  roi numeric
)
language sql security invoker set search_path = public
as $$
  with r as (
    select * from public.project_stock(p_from, p_months)
  ), m as (
    select r.month,
           sum(r.incoming_cogs)   as incoming_cogs,
           sum(r.incoming_gross)  as incoming_gross,
           sum(r.beginning_gross) as beginning_gross,
           sum(r.sales_gross)     as sales_gross,
           sum(r.sales_net)       as sales_net,
           sum(r.sales_cogs)      as sales_cogs,
           sum(r.ending_gross)    as ending_gross,
           sum(r.ending_cogs)     as ending_cogs,
           sum(r.beginning_cogs)  as beginning_cogs
    from r group by r.month
  )
  select m.month,
         m.incoming_cogs,
         m.incoming_gross,
         m.beginning_gross,
         m.sales_gross,
         m.sales_net,
         m.sales_cogs,
         m.ending_gross,
         m.ending_cogs,
         round(m.beginning_gross / nullif(m.sales_gross, 0), 2)                        as stock_ratio,
         round(m.sales_cogs / nullif((m.beginning_cogs + m.ending_cogs) / 2, 0), 2)    as ito,
         round((m.sales_net - m.sales_cogs) / nullif(m.sales_gross, 0), 4)             as gpm,
         round(m.sales_net / nullif(m.sales_cogs, 0), 2)                               as margin,
         round(m.sales_gross / nullif(m.incoming_cogs, 0), 2)                          as roi
  from m
  order by m.month;
$$;
grant execute on function public.projection_summary(date, integer) to authenticated;
