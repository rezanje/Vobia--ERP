set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('d1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','prod-owner@s.test','{"tenant_name":"Prod Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='d1111111-1111-1111-1111-111111111111');
  v_prod_uid uuid := 'd2222222-2222-2222-2222-222222222222';
  v_ops_uid uuid := 'd3333333-3333-3333-3333-333333333333';
  v_sales_uid uuid := 'd4444444-4444-4444-4444-444444444444';
  v_style uuid; v_cw uuid; v_sku uuid; v_vendor uuid;
  v_po uuid; v_line uuid;
  v_cnt int; v_failed boolean; v_recv int;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_prod_uid,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','prod-p@s.test'),
    (v_ops_uid,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','prod-o@s.test'),
    (v_sales_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','prod-s@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'production' where id = v_prod_uid;
  update public.profiles set tenant_id = v_tenant, role = 'ops'        where id = v_ops_uid;
  update public.profiles set tenant_id = v_tenant, role = 'sales'      where id = v_sales_uid;

  -- base data as postgres (RLS bypassed here)
  insert into public.styles (tenant_id, code, name) values (v_tenant,'PRD-01','Prod Style') returning id into v_style;
  insert into public.colorways (tenant_id, style_id, color_name, color_code) values (v_tenant, v_style, 'Black','BLK') returning id into v_cw;
  insert into public.skus (tenant_id, colorway_id, size, sku_code) values (v_tenant, v_cw, 'M','PRD-01-BLK-M') returning id into v_sku;
  insert into public.vendors (tenant_id, name) values (v_tenant,'Seed Vendor') returning id into v_vendor;

  -- === production role: full production write chain ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_prod_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','production')::text, true);
  perform set_config('role','authenticated', true);

  v_po := public.create_production_order(v_style, v_vendor, null, 'test', jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 10)));
  select id into v_line from public.prod_lines where po_id = v_po limit 1;
  update public.prod_lines set qty_received = 5, reject_count = 1 where id = v_line;  -- QC path
  perform public.transition_production_stage(v_po, 'mass_production');
  insert into public.cost_entries (tenant_id, po_id, cost_type, amount) values (v_tenant, v_po, 'cmt', 500000);

  reset role;

  -- === ops role: vendor allowed, production writes blocked ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);

  insert into public.vendors (tenant_id, name) values (v_tenant, 'Ops Vendor');  -- allowed

  v_failed := false;
  begin perform public.create_production_order(v_style, v_vendor, null, 'nope', jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role created a production order'; end if;

  v_failed := false;
  begin perform public.transition_production_stage(v_po, 'qc');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role transitioned a production stage'; end if;

  -- prod_lines UPDATE denial is silent (0 rows), verify by re-read (production set it to 5)
  update public.prod_lines set qty_received = 9 where id = v_line;
  select qty_received into v_recv from public.prod_lines where id = v_line;
  if v_recv <> 5 then raise exception 'FAIL: ops role updated a prod_line (got %)', v_recv; end if;

  reset role;

  -- === sales role: all production writes + vendor blocked, reads intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_production_order(v_style, v_vendor, null, 'nope', jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role created a production order'; end if;

  v_failed := false;
  begin insert into public.vendors (tenant_id, name) values (v_tenant, 'Sales Vendor');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role created a vendor'; end if;

  v_failed := false;
  begin insert into public.cost_entries (tenant_id, po_id, cost_type, amount) values (v_tenant, v_po, 'cmt', 1);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role inserted a cost entry'; end if;

  -- reads intact
  select count(*) into v_cnt from public.production_orders where id = v_po;
  if v_cnt <> 1 then raise exception 'FAIL: sales role cannot read production_orders'; end if;
  select count(*) into v_cnt from public.vendors where id = v_vendor;
  if v_cnt <> 1 then raise exception 'FAIL: sales role cannot read vendors'; end if;

  reset role;
  raise notice 'production_access OK: production writes, ops vendor-only, sales blocked on all + reads intact';
end $$;

rollback;
