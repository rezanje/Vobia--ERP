set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('e1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','pur@s.test','{"tenant_name":"Pur Co"}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('e2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','pur2@s.test','{"tenant_name":"Pur Other"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='e1111111-1111-1111-1111-111111111111');
  v_other  uuid := (select tenant_id from public.profiles where id='e2222222-2222-2222-2222-222222222222');
  v_vendor uuid; v_loc uuid; v_po uuid; v_mat uuid;
begin
  -- seed a foreign PO to test RLS
  insert into public.vendors (tenant_id, name) values (v_other, 'OthVend');
  perform set_config('request.jwt.claims',
    json_build_object('sub','e1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.vendors (tenant_id, name) values (v_tenant, 'MyVend') returning id into v_vendor;
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;
  insert into public.purchase_orders (tenant_id, code, vendor_id, location_id)
    values (v_tenant, 'PB-TEST01', v_vendor, v_loc) returning id into v_po;
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_tenant,'FAB-P','Kain','fabric','m') returning id into v_mat;
  insert into public.purchase_lines (tenant_id, po_id, material_id, qty_ordered, unit_price)
    values (v_tenant, v_po, v_mat, 50, 12000);

  -- RLS: foreign tenant's POs invisible
  if exists (select 1 from public.purchase_orders where tenant_id = v_other) then
    raise exception 'RLS leak on purchase_orders';
  end if;
  reset role;
  raise notice 'purchasing tables OK: insert + RLS';
end $$;

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='e1111111-1111-1111-1111-111111111111');
  v_vendor uuid; v_loc uuid; v_mat uuid; v_po uuid; v_line uuid;
  v_bal numeric; v_status text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','e1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.vendors (tenant_id, name) values (v_tenant, 'Vend2') returning id into v_vendor;
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_tenant, 'FAB-R', 'KainR', 'fabric', 'm') returning id into v_mat;

  v_po := public.create_purchase_order(v_vendor, v_loc, current_date, 'test PO',
    jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty_ordered', 100, 'unit_price', 15000)));
  select id into v_line from public.purchase_lines where po_id = v_po;

  -- partial receive 40 → material_in 40, qty_received 40, status still open
  perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 40)));
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 40 then raise exception 'expected 40 received, got %', v_bal; end if;
  select status into v_status from public.purchase_orders where id = v_po;
  if v_status <> 'open' then raise exception 'expected open after partial, got %', v_status; end if;

  -- over-receipt rejected (40 already + 100 > 100)
  begin
    perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 100)));
    raise exception 'OVER_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%over-receipt%' then raise; end if;
  end;

  -- receive remaining 60 → status received
  perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 60)));
  select status into v_status from public.purchase_orders where id = v_po;
  if v_status <> 'received' then raise exception 'expected received, got %', v_status; end if;
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 100 then raise exception 'expected 100 total, got %', v_bal; end if;

  raise notice 'purchasing fns OK: create, partial receive, over-receipt reject, full → received';
end $$;

rollback;
