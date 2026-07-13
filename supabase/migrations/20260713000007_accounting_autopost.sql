-- ============================================================================
-- Valuation helpers
-- ============================================================================
create or replace function public.material_avg_cost(p_material uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when coalesce(sum(qty_ordered),0) = 0 then 0
              else sum(qty_ordered*unit_price)/sum(qty_ordered) end
  from public.purchase_lines where material_id = p_material;
$$;

-- Cost accumulated per production order (issued material at avg cost + non-material
-- cost entries), and per-unit cost over received units.
create view public.po_unit_cost with (security_invoker = on) as
with mat as (
  select ml.ref_id as po_id, ml.tenant_id,
         sum(abs(ml.qty) * public.material_avg_cost(ml.material_id)) as material_value
  from public.material_ledger ml
  where ml.movement_type = 'issue_out' and ml.ref_type = 'production_order'
  group by ml.ref_id, ml.tenant_id
),
cst as (
  select po_id, sum(amount) as cost_value from public.cost_entries
  where cost_type <> 'material' group by po_id
),
un as (
  select po_id, sum(qty_received) as units from public.prod_lines group by po_id
)
select po.id as po_id, po.tenant_id,
  coalesce(mat.material_value,0) + coalesce(cst.cost_value,0) as total_cost,
  coalesce(un.units,0) as units,
  case when coalesce(un.units,0) = 0 then 0
       else (coalesce(mat.material_value,0) + coalesce(cst.cost_value,0)) / un.units end as per_unit
from public.production_orders po
left join mat on mat.po_id = po.id
left join cst on cst.po_id = po.id
left join un  on un.po_id  = po.id;
grant select on public.po_unit_cost to authenticated;

-- Weighted-average finished-goods cost per SKU (for COGS at sale).
create view public.sku_fg_cost with (security_invoker = on) as
select pl.tenant_id, pl.sku_id,
  case when sum(pl.qty_received) = 0 then 0
       else sum(pl.qty_received * puc.per_unit) / sum(pl.qty_received) end as unit_cost
from public.prod_lines pl
join public.po_unit_cost puc on puc.po_id = pl.po_id
where pl.qty_received > 0
group by pl.tenant_id, pl.sku_id;
grant select on public.sku_fg_cost to authenticated;

-- ============================================================================
-- Internal poster (explicit tenant) + public wrapper (JWT tenant)
-- ============================================================================
create or replace function public._post_journal(
  p_tenant uuid, p_created_by uuid, p_date date, p_memo text,
  p_source_type text, p_source_id uuid, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_journal uuid; v_line jsonb; v_acc uuid;
  v_debit numeric(16,2); v_credit numeric(16,2);
  v_sum_d numeric(16,2) := 0; v_sum_c numeric(16,2) := 0;
begin
  if p_tenant is null then raise exception 'tenant required'; end if;
  if p_lines is null or jsonb_array_length(p_lines) < 2 then raise exception 'jurnal butuh minimal 2 baris'; end if;

  if p_source_type is not null and p_source_id is not null then
    select id into v_journal from public.journals
      where tenant_id = p_tenant and source_type = p_source_type and source_id = p_source_id;
    if v_journal is not null then return v_journal; end if;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);
    if v_debit < 0 or v_credit < 0 then raise exception 'debit/kredit tidak boleh negatif'; end if;
    if v_debit > 0 and v_credit > 0 then raise exception 'satu baris hanya debit atau kredit'; end if;
    v_sum_d := v_sum_d + v_debit; v_sum_c := v_sum_c + v_credit;
  end loop;
  if v_sum_d = 0 and v_sum_c = 0 then raise exception 'jurnal kosong'; end if;
  if v_sum_d <> v_sum_c then raise exception 'jurnal tidak seimbang: debit % vs kredit %', v_sum_d, v_sum_c; end if;

  insert into public.journals (tenant_id, journal_date, memo, source_type, source_id, created_by)
  values (p_tenant, coalesce(p_date, current_date), p_memo, p_source_type, p_source_id, p_created_by)
  returning id into v_journal;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);
    if v_debit = 0 and v_credit = 0 then continue; end if;
    select id into v_acc from public.accounts where tenant_id = p_tenant and code = (v_line ->> 'account_code');
    if v_acc is null then raise exception 'akun tidak ditemukan: %', (v_line ->> 'account_code'); end if;
    insert into public.journal_lines (tenant_id, journal_id, account_id, debit, credit, memo)
    values (p_tenant, v_journal, v_acc, v_debit, v_credit, v_line ->> 'memo');
  end loop;

  return v_journal;
end; $$;

create or replace function public.post_journal(
  p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return public._post_journal(
    (auth.jwt() ->> 'tenant_id')::uuid, auth.uid(), p_date, p_memo, p_source_type, p_source_id, p_lines);
end; $$;

grant execute on function public.material_avg_cost(uuid) to authenticated;
grant execute on function public._post_journal(uuid, uuid, date, text, text, uuid, jsonb) to authenticated;

-- ============================================================================
-- Auto-posting triggers. Skip when there is no JWT (direct DB / seed / migration
-- writes are not journaled — only real app usage is). Opening balance seeds books.
-- ============================================================================
create or replace function public.tg_material_journal() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_val numeric; v_price numeric;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return null; end if;
  if NEW.movement_type = 'purchase_in' then
    select unit_price into v_price from public.purchase_lines where id = NEW.ref_id;
    v_val := round(NEW.qty * coalesce(v_price,0), 2);
    if v_val > 0 then
      perform public._post_journal(NEW.tenant_id, NEW.created_by, NEW.created_at::date,
        'Pembelian bahan', 'material_ledger', NEW.id, jsonb_build_array(
          jsonb_build_object('account_code','1-1300','debit',v_val),
          jsonb_build_object('account_code','2-1100','credit',v_val)));
    end if;
  elsif NEW.movement_type = 'issue_out' then
    v_val := round(abs(NEW.qty) * public.material_avg_cost(NEW.material_id), 2);
    if v_val > 0 then
      perform public._post_journal(NEW.tenant_id, NEW.created_by, NEW.created_at::date,
        'Issue bahan ke produksi', 'material_ledger', NEW.id, jsonb_build_array(
          jsonb_build_object('account_code','1-1310','debit',v_val),
          jsonb_build_object('account_code','1-1300','credit',v_val)));
    end if;
  end if;
  return null;
end; $$;
create trigger material_journal after insert on public.material_ledger
  for each row execute function public.tg_material_journal();

create or replace function public.tg_cost_journal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return null; end if;
  if NEW.cost_type = 'material' then return null; end if;  -- material value flows via issue
  perform public._post_journal(NEW.tenant_id, null, NEW.created_at::date,
    'Biaya produksi: ' || NEW.cost_type, 'cost_entry', NEW.id, jsonb_build_array(
      jsonb_build_object('account_code','1-1310','debit',NEW.amount),
      jsonb_build_object('account_code','2-1100','credit',NEW.amount)));
  return null;
end; $$;
create trigger cost_journal after insert on public.cost_entries
  for each row execute function public.tg_cost_journal();

create or replace function public.tg_stock_journal() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_po uuid; v_puc numeric; v_price numeric; v_order uuid; v_val numeric;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return null; end if;

  if NEW.movement_type = 'production_in' then
    select pl.po_id into v_po from public.prod_lines pl where pl.id = NEW.ref_id;
    select per_unit into v_puc from public.po_unit_cost where po_id = v_po;
    v_val := round(NEW.qty * coalesce(v_puc,0), 2);
    if v_val > 0 then
      perform public._post_journal(NEW.tenant_id, NEW.created_by, NEW.created_at::date,
        'Barang jadi masuk', 'stock_ledger', NEW.id, jsonb_build_array(
          jsonb_build_object('account_code','1-1320','debit',v_val),
          jsonb_build_object('account_code','1-1310','credit',v_val)));
    end if;

  elsif NEW.movement_type = 'sale_out' then
    select ol.unit_price into v_price from public.order_lines ol where ol.id = NEW.ref_id;
    v_val := round(abs(NEW.qty) * coalesce(v_price,0), 2);
    if v_val > 0 then
      perform public._post_journal(NEW.tenant_id, NEW.created_by, NEW.created_at::date,
        'Penjualan', 'stock_sale_rev', NEW.id, jsonb_build_array(
          jsonb_build_object('account_code','1-1210','debit',v_val),
          jsonb_build_object('account_code','4-1000','credit',v_val)));
    end if;
    select unit_cost into v_puc from public.sku_fg_cost where sku_id = NEW.sku_id;
    v_val := round(abs(NEW.qty) * coalesce(v_puc,0), 2);
    if v_val > 0 then
      perform public._post_journal(NEW.tenant_id, NEW.created_by, NEW.created_at::date,
        'HPP penjualan', 'stock_sale_cogs', NEW.id, jsonb_build_array(
          jsonb_build_object('account_code','5-1000','debit',v_val),
          jsonb_build_object('account_code','1-1320','credit',v_val)));
    end if;

  elsif NEW.movement_type = 'return_in' then
    select r.order_id into v_order from public.returns r
      join public.return_lines rl on rl.return_id = r.id where rl.id = NEW.ref_id;
    select unit_price into v_price from public.order_lines
      where order_id = v_order and sku_id = NEW.sku_id limit 1;
    v_val := round(NEW.qty * coalesce(v_price,0), 2);
    if v_val > 0 then
      perform public._post_journal(NEW.tenant_id, NEW.created_by, NEW.created_at::date,
        'Retur penjualan', 'stock_return_rev', NEW.id, jsonb_build_array(
          jsonb_build_object('account_code','4-1100','debit',v_val),
          jsonb_build_object('account_code','1-1210','credit',v_val)));
    end if;
    select unit_cost into v_puc from public.sku_fg_cost where sku_id = NEW.sku_id;
    v_val := round(NEW.qty * coalesce(v_puc,0), 2);
    if v_val > 0 then
      perform public._post_journal(NEW.tenant_id, NEW.created_by, NEW.created_at::date,
        'Barang retur masuk', 'stock_return_cogs', NEW.id, jsonb_build_array(
          jsonb_build_object('account_code','1-1320','debit',v_val),
          jsonb_build_object('account_code','5-1000','credit',v_val)));
    end if;
  end if;
  return null;
end; $$;
create trigger stock_journal after insert on public.stock_ledger
  for each row execute function public.tg_stock_journal();

-- ============================================================================
-- Opening balance: book current inventory value against Modal, once per tenant.
-- ============================================================================
create or replace function public.post_opening_balance() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_bahan numeric := 0; v_jadi numeric := 0; v_total numeric;
  v_lines jsonb := '[]'::jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;

  -- current material inventory value (balance qty * avg cost)
  select coalesce(sum(mb.balance * public.material_avg_cost(mb.material_id)), 0)
    into v_bahan from public.material_balances mb where mb.tenant_id = v_tenant;

  -- current finished-goods value (balance qty * sku fg cost)
  select coalesce(sum(sb.balance * coalesce(fg.unit_cost,0)), 0)
    into v_jadi from public.stock_balances sb
    left join public.sku_fg_cost fg on fg.sku_id = sb.sku_id
    where sb.tenant_id = v_tenant;

  v_bahan := round(v_bahan, 2); v_jadi := round(v_jadi, 2);
  v_total := v_bahan + v_jadi;
  if v_total <= 0 then raise exception 'tidak ada nilai persediaan untuk saldo awal'; end if;

  if v_bahan > 0 then v_lines := v_lines || jsonb_build_object('account_code','1-1300','debit',v_bahan); end if;
  if v_jadi  > 0 then v_lines := v_lines || jsonb_build_object('account_code','1-1320','debit',v_jadi); end if;
  v_lines := v_lines || jsonb_build_object('account_code','3-1000','credit',v_total,'memo','Saldo awal persediaan');

  return public._post_journal(v_tenant, auth.uid(), current_date, 'Saldo awal', 'opening_balance', v_tenant, v_lines);
end; $$;
grant execute on function public.post_opening_balance() to authenticated;
