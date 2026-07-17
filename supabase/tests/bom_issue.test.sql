set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('f1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','bom@s.test','{"tenant_name":"Bom Co"}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('f2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','bom2@s.test','{"tenant_name":"Bom Other"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='f1111111-1111-1111-1111-111111111111');
  v_other  uuid := (select tenant_id from public.profiles where id='f2222222-2222-2222-2222-222222222222');
  v_style uuid; v_mat uuid;
begin
  -- foreign BOM row for RLS
  insert into public.styles (tenant_id, code, name) values (v_other, 'OTHS', 'Oth') returning id into v_style;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_other,'OM','Oth','fabric','m') returning id into v_mat;
  insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit) values (v_other, v_style, v_mat, 1.5);

  perform set_config('request.jwt.claims',
    json_build_object('sub','f1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text,'user_role','owner')::text, true);
  perform set_config('role','authenticated', true);

  insert into public.styles (tenant_id, code, name) values (v_tenant, 'MYS', 'My') returning id into v_style;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_tenant,'MM','Mine','fabric','m') returning id into v_mat;
  insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit) values (v_tenant, v_style, v_mat, 1.25);

  -- RLS: foreign BOM invisible
  if exists (select 1 from public.bom_lines where tenant_id = v_other) then raise exception 'RLS leak on bom_lines'; end if;
  reset role;
  raise notice 'bom_lines OK: insert + RLS';
end $$;

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='f1111111-1111-1111-1111-111111111111');
  v_style uuid; v_mat uuid; v_loc uuid; v_vendor uuid; v_prod uuid; v_sku uuid; v_bal numeric;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','f1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text,'user_role','owner')::text, true);
  perform set_config('role','authenticated', true);

  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_tenant,'ISS-M','IssMat','fabric','m') returning id into v_mat;
  insert into public.vendors (tenant_id, name) values (v_tenant, 'IssVend') returning id into v_vendor;
  v_style := public.create_style_with_skus('ISS-STY','IssStyle','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;
  v_prod := public.create_production_order(v_style, v_vendor, null, 'cmt',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 10)));
  -- new orders start as draft; issuing material requires an approved order
  update public.production_orders set doc_status = 'approved' where id = v_prod;

  -- stock the material first
  perform public.record_material_movement(v_mat, 50, 'purchase_in', null, null, null, v_loc);

  -- issue 20 → balance 30, negative issue_out row exists
  perform public.issue_material_to_po(v_prod, jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty', 20)), v_loc);
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 30 then raise exception 'expected 30 after issue, got %', v_bal; end if;
  if not exists (select 1 from public.material_ledger where material_id = v_mat and movement_type = 'issue_out' and qty = -20 and ref_id = v_prod) then
    raise exception 'issue_out row not stored as -20 with prod ref';
  end if;

  -- insufficient balance rejected (only 30 left, ask 999)
  begin
    perform public.issue_material_to_po(v_prod, jsonb_build_array(jsonb_build_object('material_id', v_mat, 'qty', 999)), v_loc);
    raise exception 'INSUF_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%insufficient%' then raise; end if;
  end;

  raise notice 'issue_material_to_po OK: negative issue, prod ref, insufficient reject';
end $$;

rollback;
