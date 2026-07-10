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

rollback;
