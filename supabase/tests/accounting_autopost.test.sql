set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('a2111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','autopost@s.test','{"tenant_name":"AutoPost Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='a2111111-1111-1111-1111-111111111111');
  v_loc uuid; v_vendor uuid; v_mat uuid; v_po uuid; v_line uuid;
  v_ch uuid; v_style uuid; v_sku uuid; v_prodpo uuid; v_pl uuid; v_order uuid;
  v_persediaan numeric; v_hutang numeric; v_penjualan numeric; v_td numeric; v_tc numeric;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','a2111111-1111-1111-1111-111111111111','role','authenticated',
      'user_role','owner','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  select id into v_loc from public.locations where tenant_id=v_tenant and is_default;
  insert into public.vendors (tenant_id, name) values (v_tenant,'V') returning id into v_vendor;
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_tenant,'FAB','Kain','fabric','m') returning id into v_mat;

  -- PURCHASE + RECEIVE -> Dr Persediaan Bahan / Cr Hutang Usaha @ 100*5000=500000
  v_po := public.create_purchase_order(v_vendor, v_loc, current_date, '',
    jsonb_build_array(jsonb_build_object('material_id',v_mat,'qty_ordered',100,'unit_price',5000)));
  update public.purchase_orders set doc_status='approved' where id=v_po;
  select id into v_line from public.purchase_lines where po_id=v_po;
  perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id',v_line,'qty',100)));

  select balance into v_persediaan from public.account_balances where tenant_id=v_tenant and account_code='1-1300';
  if v_persediaan <> 500000 then raise exception 'FAIL: persediaan bahan = %, expected 500000', v_persediaan; end if;
  select -balance into v_hutang from public.account_balances where tenant_id=v_tenant and account_code='2-1100';
  if v_hutang <> 500000 then raise exception 'FAIL: hutang usaha = %, expected 500000', v_hutang; end if;

  -- PRODUCE a sku with a cost, receive it, complete -> finished goods valued
  insert into public.channels (tenant_id, name) values (v_tenant,'Shopee') returning id into v_ch;
  v_style := public.create_style_with_skus('ST','Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k join public.colorways c on c.id=k.colorway_id where c.style_id=v_style limit 1;
  v_prodpo := public.create_production_order(v_style, v_vendor, null, 'cmt',
    jsonb_build_array(jsonb_build_object('sku_id',v_sku,'qty_ordered',10)));
  update public.production_orders set doc_status='approved' where id=v_prodpo;
  -- cost entry 2,000,000 cmt over 10 units -> per unit 200,000
  insert into public.cost_entries (tenant_id, po_id, cost_type, amount) values (v_tenant, v_prodpo, 'cmt', 2000000);
  update public.prod_lines set qty_received=10 where po_id=v_prodpo;
  perform public.transition_production_stage(v_prodpo, 'mass_production');
  perform public.transition_production_stage(v_prodpo, 'qc');
  perform public.transition_production_stage(v_prodpo, 'completed');  -- fires production_in

  -- SELL 2 units @ 500,000 -> revenue 1,000,000; COGS 2*200,000=400,000
  v_order := public.create_order(v_ch, current_date, 'Cust', '',
    jsonb_build_array(jsonb_build_object('sku_id',v_sku,'qty',2,'unit_price',500000)));

  select -balance into v_penjualan from public.account_balances where tenant_id=v_tenant and account_code='4-1000';
  if v_penjualan <> 1000000 then raise exception 'FAIL: penjualan = %, expected 1000000', v_penjualan; end if;
  if (select balance from public.account_balances where tenant_id=v_tenant and account_code='5-1000') <> 400000 then
    raise exception 'FAIL: HPP wrong = %', (select balance from public.account_balances where tenant_id=v_tenant and account_code='5-1000'); end if;

  -- trial balance must stay balanced
  select coalesce(sum(total_debit),0), coalesce(sum(total_credit),0)
    into v_td, v_tc from public.account_balances where tenant_id=v_tenant;
  if v_td <> v_tc then raise exception 'FAIL: trial balance off D% C%', v_td, v_tc; end if;

  raise notice 'OK autopost (persediaan=%, penjualan=%, TB D=C=%)', v_persediaan, v_penjualan, v_td;
end $$;

rollback;
