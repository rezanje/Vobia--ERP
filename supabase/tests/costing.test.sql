set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('c9999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','co@c.test','{"tenant_name":"CO Co"}');

select set_config('request.jwt.claims',
  json_build_object('sub','c9999999-9999-9999-9999-999999999999','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='c9999999-9999-9999-9999-999999999999'))::text, true);
set local role authenticated;

do $$
declare
  v_vendor uuid; v_style uuid; v_sku uuid; v_po1 uuid; v_po2 uuid;
  v_hpp numeric; v_units int; v_cnt int;
begin
  insert into public.vendors (name) values ('CO Vendor') returning id into v_vendor;
  v_style := public.create_style_with_skus('CO-STY','CO Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  v_po1 := public.create_production_order(v_style, v_vendor, null, '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 100)));
  update public.prod_lines set qty_received = 100 where po_id = v_po1;
  perform public.transition_production_stage(v_po1, 'mass_production');
  perform public.transition_production_stage(v_po1, 'qc');
  perform public.transition_production_stage(v_po1, 'completed');
  insert into public.cost_entries (po_id, cost_type, amount) values (v_po1, 'material', 5000);

  select hpp, costed_units into v_hpp, v_units from public.sku_hpp where sku_id = v_sku;
  if v_hpp <> 50 then raise exception 'expected hpp 50, got %', v_hpp; end if;
  if v_units <> 100 then raise exception 'expected 100 costed units, got %', v_units; end if;

  v_po2 := public.create_production_order(v_style, v_vendor, null, '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 100)));
  update public.prod_lines set qty_received = 100 where po_id = v_po2;
  perform public.transition_production_stage(v_po2, 'mass_production');
  perform public.transition_production_stage(v_po2, 'qc');
  perform public.transition_production_stage(v_po2, 'completed');
  insert into public.cost_entries (po_id, cost_type, amount) values (v_po2, 'material', 6000);

  select hpp, costed_units into v_hpp, v_units from public.sku_hpp where sku_id = v_sku;
  if v_hpp <> 55 then raise exception 'expected hpp 55, got %', v_hpp; end if;
  if v_units <> 200 then raise exception 'expected 200 costed units, got %', v_units; end if;

  select count(*) into v_cnt from public.cost_entries;
  if v_cnt <> 2 then raise exception 'expected 2 own cost_entries, got %', v_cnt; end if;

  raise notice 'costing OK: hpp 50 -> 55 weighted avg, RLS-scoped';
end $$;

rollback;
