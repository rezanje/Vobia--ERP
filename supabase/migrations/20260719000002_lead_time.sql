-- Lead time produksi/pembelian.
--
-- Sheet client tidak punya konsep ini: kolom Incoming diasumsikan datang di bulan
-- yang sama dengan saat dibutuhkan. Untuk CMT/FOB itu tidak realistis — kain, jahit,
-- dan kirim makan waktu berbulan-bulan.
--
-- Modelnya sengaja dibuat sesederhana mungkin: roll stok TIDAK berubah sama sekali
-- (kebutuhan kedatangan per bulan tetap sama). Yang ditambah hanya jawaban atas
-- "kapan barang ini harus mulai dipesan":
--
--   order_month = bulan kedatangan - lead_time_months
--
-- Kalau order_month sudah lewat, artinya pesanan itu telat — dan itu justru
-- informasi paling berharganya.

alter table public.planning_params
  add column lead_time_months integer not null default 2
    check (lead_time_months between 0 and 12);

-- signature lama diganti (bukan ditambah overload) supaya tetap satu jalur tulis
drop function if exists public.set_planning_params(numeric, integer, numeric);

create or replace function public.set_planning_params(
  p_cover_months numeric, p_selling_days integer, p_net_rate numeric,
  p_lead_time_months integer
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

  insert into public.planning_params (tenant_id, cover_months, selling_days, net_rate, lead_time_months)
  values (v_tenant, p_cover_months, p_selling_days, p_net_rate, p_lead_time_months)
  on conflict (tenant_id) do update
    set cover_months     = excluded.cover_months,
        selling_days     = excluded.selling_days,
        net_rate         = excluded.net_rate,
        lead_time_months = excluded.lead_time_months,
        updated_at       = now();
end;
$$;
grant execute on function public.set_planning_params(numeric, integer, numeric, integer) to authenticated;


-- Kolom balikan bertambah -> fungsi harus di-drop dulu, tidak bisa create or replace.
-- projection_summary bergantung ke project_stock, jadi urutannya turunan dulu.
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
         (o.month - make_interval(months => v_lead))::date,
         o.beginning,
         o.incoming,
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
