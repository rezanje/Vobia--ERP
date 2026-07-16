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
  perform set_config('role','authenticated', true);

  insert into public.styles (tenant_id, code, name) values (v_tenant, 'TST-01', 'Test Style') returning id into v_style;
  insert into public.vendors (tenant_id, name) values (v_tenant, 'Vendor Test') returning id into v_vendor;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_tenant, 'KAIN-T', 'Kain Test', 'fabric', 'm') returning id into v_mat;

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
