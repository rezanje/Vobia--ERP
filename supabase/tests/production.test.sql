set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a7777777-7777-7777-7777-777777777777','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pv_a@a.test','{"tenant_name":"PV A"}'),
  ('b8888888-8888-8888-8888-888888888888','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pv_b@b.test','{"tenant_name":"PV B"}');

insert into public.vendors (tenant_id, name)
  values ((select tenant_id from public.profiles where id='b8888888-8888-8888-8888-888888888888'), 'B Vendor');

select set_config('request.jwt.claims',
  json_build_object('sub','a7777777-7777-7777-7777-777777777777','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='a7777777-7777-7777-7777-777777777777'))::text, true);
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.vendors;
  if n <> 0 then raise exception 'RLS FAIL: tenant A sees % vendors from B', n; end if;
  raise notice 'PV RLS OK: tenant A sees 0 of tenant B vendors';
end $$;

do $$
declare
  v_tenant uuid := (current_setting('request.jwt.claims')::json->>'tenant_id')::uuid;
  v_vendor uuid; v_style uuid; v_sku uuid; v_po uuid;
  v_stage text; v_lines int; v_bal int;
begin
  insert into public.vendors (tenant_id, name) values (v_tenant, 'Vendor A') returning id into v_vendor;
  v_style := public.create_style_with_skus('PV-STY','PV Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  v_po := public.create_production_order(v_style, v_vendor, current_date, 'note',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 100)));

  select stage into v_stage from public.production_orders where id = v_po;
  if v_stage <> 'trial' then raise exception 'expected trial, got %', v_stage; end if;
  select count(*) into v_lines from public.prod_lines where po_id = v_po;
  if v_lines <> 1 then raise exception 'expected 1 line, got %', v_lines; end if;

  begin
    perform public.create_production_order(gen_random_uuid(), v_vendor, null, '',
      jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 5)));
    raise exception 'STYLE_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%style not in tenant%' then raise; end if; end;

  begin
    perform public.transition_production_stage(v_po, 'completed');
    raise exception 'TRANS_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%illegal transition%' then raise; end if; end;

  perform public.transition_production_stage(v_po, 'mass_production');
  perform public.transition_production_stage(v_po, 'qc');
  update public.prod_lines set qty_received = 90 where po_id = v_po;
  perform public.transition_production_stage(v_po, 'completed');

  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 90 then raise exception 'expected balance 90, got %', v_bal; end if;

  begin
    perform public.transition_production_stage(v_po, 'completed');
    raise exception 'IDEM_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%illegal transition%' then raise; end if; end;
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 90 then raise exception 'stock changed after idempotent complete: %', v_bal; end if;

  raise notice 'production OK: create, guard, legal/illegal transition, complete->stock 90, idempotent';
end $$;

rollback;
