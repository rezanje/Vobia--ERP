set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('d1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','doc-owner@s.test','{"tenant_name":"Doc Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='d1111111-1111-1111-1111-111111111111');
  v_style uuid; v_vendor uuid; v_loc uuid; v_po uuid; v_po2 uuid;
  v_mat uuid; v_draftpo uuid; v_purchase uuid; v_line uuid;
begin
  -- owner claims
  perform set_config('request.jwt.claims',
    json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated',
      'user_role','owner','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.styles (tenant_id, code, name) values (v_tenant,'S1','Style') returning id into v_style;
  insert into public.vendors (tenant_id, name) values (v_tenant,'V1') returning id into v_vendor;
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;
  insert into public.production_orders (tenant_id, code, style_id, vendor_id)
    values (v_tenant,'PO-DRAFT', v_style, v_vendor) returning id into v_po;

  -- default is draft
  if (select doc_status from public.production_orders where id=v_po) <> 'draft' then
    raise exception 'FAIL: new order should be draft'; end if;

  -- owner can approve
  perform public.approve_document('production', v_po);
  if (select doc_status from public.production_orders where id=v_po) <> 'approved' then
    raise exception 'FAIL: owner approve did not stick'; end if;

  -- viewer cannot approve
  insert into public.production_orders (tenant_id, code, style_id, vendor_id)
    values (v_tenant,'PO-DRAFT2', v_style, v_vendor) returning id into v_po2;
  perform set_config('request.jwt.claims',
    json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated',
      'user_role','viewer','tenant_id',v_tenant::text)::text, true);
  begin
    perform public.approve_document('production', v_po2);
    raise exception 'FAIL: viewer should not approve';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- back to owner for gate tests
  perform set_config('request.jwt.claims',
    json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated',
      'user_role','owner','tenant_id',v_tenant::text)::text, true);

  -- gate: issuing material to a DRAFT production order must fail
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_tenant,'M-G','Kain','fabric','m') returning id into v_mat;
  insert into public.production_orders (tenant_id, code, style_id, vendor_id)
    values (v_tenant,'PO-GATE', v_style, v_vendor) returning id into v_draftpo;
  begin
    perform public.issue_material_to_po(v_draftpo,
      jsonb_build_array(jsonb_build_object('material_id',v_mat::text,'qty',1)), null);
    raise exception 'FAIL: issue on draft should be blocked';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- gate: receiving a DRAFT purchase order must fail
  insert into public.purchase_orders (tenant_id, code, vendor_id, location_id)
    values (v_tenant,'PB-GATE', v_vendor, v_loc) returning id into v_purchase;
  insert into public.purchase_lines (tenant_id, po_id, material_id, qty_ordered, unit_price)
    values (v_tenant, v_purchase, v_mat, 10, 1000) returning id into v_line;
  begin
    perform public.receive_purchase(v_purchase,
      jsonb_build_array(jsonb_build_object('line_id',v_line::text,'qty',5)));
    raise exception 'FAIL: receive on draft should be blocked';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- after ACC, receive works
  perform public.approve_document('purchase', v_purchase);
  perform public.receive_purchase(v_purchase,
    jsonb_build_array(jsonb_build_object('line_id',v_line::text,'qty',5)));
  if (select qty_received from public.purchase_lines where id=v_line) <> 5 then
    raise exception 'FAIL: receive after ACC did not record'; end if;

  raise notice 'OK doc_approval';
end $$;

rollback;
