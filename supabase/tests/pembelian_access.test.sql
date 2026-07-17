set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('a8811111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','buy-owner@s.test','{"tenant_name":"Buy Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='a8811111-1111-1111-1111-111111111111');
  v_ops_uid uuid := 'a8822222-2222-2222-2222-222222222222';
  v_fin_uid uuid := 'a8833333-3333-3333-3333-333333333333';
  v_vendor uuid; v_mat uuid; v_loc uuid;
  v_po uuid; v_line uuid; v_cnt int; v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_ops_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','buy-ops@s.test'),
    (v_fin_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','buy-fin@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'ops'     where id = v_ops_uid;
  update public.profiles set tenant_id = v_tenant, role = 'finance' where id = v_fin_uid;

  -- base data as postgres (RLS bypassed). The new-user trigger already seeded a default location.
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
  insert into public.vendors (tenant_id, name) values (v_tenant,'Buy Vendor') returning id into v_vendor;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_tenant,'BUY-MAT','Kain Buy','fabric','m') returning id into v_mat;

  -- === ops role: create PO + receive allowed ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);

  v_po := public.create_purchase_order(v_vendor, v_loc, null, 'test', jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty_ordered', 10, 'unit_price', 5000)));
  select id into v_line from public.purchase_lines where po_id = v_po limit 1;

  -- receive_purchase has an approval gate ('purchase order belum di-ACC' unless doc_status='approved').
  -- The PO defaults to doc_status='draft', so approve it as postgres (RLS bypassed) before receiving.
  reset role;
  update public.purchase_orders set doc_status = 'approved' where id = v_po;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);

  perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 4)));

  reset role;

  -- === finance role: create + receive blocked, reads intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_fin_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','finance')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_purchase_order(v_vendor, v_loc, null, 'x', jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty_ordered', 1, 'unit_price', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: finance role created a purchase order'; end if;

  -- receive block exercises the SECURITY DEFINER in-body guard specifically
  v_failed := false;
  begin perform public.receive_purchase(v_po, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: finance role received goods (definer guard bypassed)'; end if;

  -- reads intact
  select count(*) into v_cnt from public.purchase_orders where id = v_po;
  if v_cnt <> 1 then raise exception 'FAIL: finance role cannot read purchase_orders'; end if;

  reset role;
  raise notice 'pembelian_access OK: ops creates+receives, finance blocked on create+receive (definer guard) + reads intact';
end $$;

rollback;
