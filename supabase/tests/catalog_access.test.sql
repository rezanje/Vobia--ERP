set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('c1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','cat-owner@s.test','{"tenant_name":"Cat Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='c1111111-1111-1111-1111-111111111111');
  v_prod_uid uuid := 'c2222222-2222-2222-2222-222222222222';
  v_sales_uid uuid := 'c3333333-3333-3333-3333-333333333333';
  v_style uuid;
  v_sku uuid;
  v_mat uuid;
  v_cnt int;
  v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_prod_uid,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cat-prod@s.test'),
    (v_sales_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cat-sales@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'production' where id = v_prod_uid;
  update public.profiles set tenant_id = v_tenant, role = 'sales'      where id = v_sales_uid;

  -- === production role: catalog writes allowed ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_prod_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','production')::text, true);
  perform set_config('role','authenticated', true);

  v_style := public.create_style_with_skus('CAT-01','Cat Style',null,
    jsonb_build_array(jsonb_build_object('color_name','Black','color_code','BLK')),
    array['M','L']);
  select id into v_sku from public.skus where tenant_id = v_tenant limit 1;
  update public.skus set active = false where id = v_sku;   -- SkuToggle path
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_tenant,'MAT-01','Kain Test','fabric','m') returning id into v_mat;
  insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit)
    values (v_tenant, v_style, v_mat, 1.5);

  reset role;

  -- === sales role: every catalog write blocked, but reads still work ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_style_with_skus('CAT-X','X',null,
      jsonb_build_array(jsonb_build_object('color_name','Red','color_code','RED')), array['M']);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role created a style'; end if;

  v_failed := false;
  begin update public.skus set active = true where id = v_sku;
  exception when others then v_failed := true; end;
  -- RLS update denial does not raise; it silently updates 0 rows. Verify no row changed:
  if (select active from public.skus where id = v_sku) is distinct from false then
    raise exception 'FAIL: sales role updated a sku';
  end if;

  v_failed := false;
  begin insert into public.materials (tenant_id, code, name, category, uom)
      values (v_tenant,'MAT-SALES','Nope','fabric','m');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role inserted a material'; end if;

  v_failed := false;
  begin insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit)
      values (v_tenant, v_style, v_mat, 2);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role inserted a bom line'; end if;

  -- reads NOT broken: sales can still SELECT styles + materials
  select count(*) into v_cnt from public.styles where id = v_style;
  if v_cnt <> 1 then raise exception 'FAIL: sales role cannot read styles (read over-restricted)'; end if;
  select count(*) into v_cnt from public.materials where id = v_mat;
  if v_cnt <> 1 then raise exception 'FAIL: sales role cannot read materials (read over-restricted)'; end if;

  reset role;
  raise notice 'catalog_access OK: production writes, sales blocked on style/sku/material/bom writes, sales reads intact';
end $$;

rollback;
