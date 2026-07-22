-- Barang yang sudah dipesan tapi belum datang ("in transit").
--
-- Tanpa ini, proyeksi buta terhadap order yang sedang berjalan: begitu PO dibuat,
-- stok belum bertambah (barang belum diterima), jadi bulan berikutnya sistem akan
-- menyuruh memesan barang yang sama lagi. Itu resep double-order.
--
-- Sumbernya prod_lines: qty_ordered - qty_received, hanya untuk production order
-- yang masih hidup (bukan completed/canceled). Bagian yang sudah diterima tidak
-- dihitung di sini karena sudah masuk stock_ledger — jadi tidak ada dobel.
--
-- incoming_qty sekarang dipecah dua:
--   committed_qty = sudah dipesan, tinggal ditunggu
--   suggested_qty = kekurangan yang masih harus dipesan
--   incoming_qty  = committed + suggested (total yang datang bulan itu)
--
-- Efeknya: setelah PO dibuat, suggested turun ke 0 dengan sendirinya.

drop function if exists public.projection_summary(date, integer);
drop function if exists public.project_stock(date, integer);

create or replace function public.project_stock(p_from date, p_months integer default 6)
returns table (
  sku_id uuid,
  sku_code text,
  month date,
  order_month date,
  beginning_qty integer,
  incoming_qty integer,
  committed_qty integer,
  suggested_qty integer,
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
  v_lead integer;
  v_i integer;
  v_month date;
  v_last date;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_from <> date_trunc('month', p_from)::date then
    raise exception 'p_from harus tanggal 1';
  end if;
  if p_months < 1 or p_months > 24 then raise exception 'p_months harus 1..24'; end if;

  select coalesce(max(pp.cover_months), 1.5),
         coalesce(max(pp.net_rate), 0.95),
         coalesce(max(pp.lead_time_months), 2)
    into v_cover, v_net, v_lead
    from public.planning_params pp where pp.tenant_id = v_tenant;

  v_last := (p_from + make_interval(months => p_months - 1))::date;

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
    committed integer,
    suggested integer,
    sales integer,
    ending integer
  ) on commit drop;

  -- Order berjalan, dikelompokkan ke bulan kedatangan yang dijanjikan.
  -- Deadline kosong atau sudah lewat dianggap datang di bulan pertama horizon:
  -- barangnya nyata sedang dibuat, menyembunyikannya justru bikin over-order.
  drop table if exists _committed;
  create temp table _committed as
  select pl.sku_id,
         case
           when po.deadline is null or po.deadline < p_from then p_from
           else date_trunc('month', po.deadline)::date
         end as month,
         sum(pl.qty_ordered - pl.qty_received)::integer as qty
  from public.prod_lines pl
  join public.production_orders po on po.id = pl.po_id
  where pl.tenant_id = v_tenant
    and po.stage not in ('completed', 'canceled')
    and pl.qty_ordered > pl.qty_received
    and (po.deadline is null or date_trunc('month', po.deadline)::date <= v_last)
  group by 1, 2;
  create index on _committed (sku_id, month);

  insert into _roll (sku_id, carry)
  select k.id, coalesce(b.balance, 0)
  from public.skus k
  left join public.stock_balances b on b.sku_id = k.id and b.tenant_id = v_tenant
  where k.tenant_id = v_tenant and k.active;

  for v_i in 0 .. p_months - 1 loop
    v_month := (p_from + make_interval(months => v_i))::date;

    insert into _out (sku_id, month, beginning, incoming, committed, suggested, sales, ending)
    select r.sku_id,
           v_month,
           r.carry + c.qty + sug.v,
           c.qty + sug.v,
           c.qty,
           sug.v,
           d.qty,
           r.carry + c.qty + sug.v - d.qty
    from _roll r
    cross join lateral (
      select coalesce((
        select dp.qty from public.demand_plan dp
        where dp.tenant_id = v_tenant and dp.sku_id = r.sku_id and dp.month = v_month
      ), 0) as qty
    ) d
    cross join lateral (
      select coalesce((
        select cm.qty from _committed cm
        where cm.sku_id = r.sku_id and cm.month = v_month
      ), 0) as qty
    ) c
    -- yang diusulkan hanya kekurangannya: stok lama + barang yang sudah dipesan
    -- dipotong lebih dulu
    cross join lateral (
      select greatest(0, ceil(d.qty * v_cover)::integer - r.carry - c.qty) as v
    ) sug;

    update _roll r
      set carry = o.ending
      from _out o
     where o.sku_id = r.sku_id and o.month = v_month;
  end loop;

  return query
  select o.sku_id,
         k.sku_code,
         o.month,
         (o.month - make_interval(months => v_lead))::date,
         o.beginning,
         o.incoming,
         o.committed,
         o.suggested,
         o.sales,
         o.ending,
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
