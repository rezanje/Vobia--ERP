set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('b1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','owner-role@s.test','{"tenant_name":"Role Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='b1111111-1111-1111-1111-111111111111');
  v_sales_uid uuid := 'b2222222-2222-2222-2222-222222222222';
  v_ops_uid uuid := 'b3333333-3333-3333-3333-333333333333';
  v_style uuid;
  v_vendor uuid;
  v_proj uuid;
  v_pcb uuid;
  v_ppo uuid;
  v_cnt int;
  v_failed boolean;
begin
  -- second/third tenant member, same tenant, roles sales/ops
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_sales_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sales-role@s.test'),
    (v_ops_uid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ops-role@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'sales' where id = v_sales_uid;
  update public.profiles set tenant_id = v_tenant, role = 'ops'   where id = v_ops_uid;

  insert into public.styles (tenant_id, code, name) values (v_tenant, 'ROLE-01', 'Role Test Style') returning id into v_style;
  insert into public.vendors (tenant_id, name) values (v_tenant, 'Role Vendor') returning id into v_vendor;

  -- === sales role: allowed sales-kind forecast, blocked from ops-kind ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text, 'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  perform public.create_forecast('sales', '2026-Q3', null, jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));

  v_failed := false;
  begin
    perform public.create_forecast('ops', '2026-Q3', null, jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: sales role was able to create an ops-kind forecast'; end if;

  -- sales blocked from create_projection, lock_projection, create_pcb, create_ppo, issue_ppo_pos
  v_failed := false;
  begin perform public.create_projection('2026-Q3', jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to create a projection'; end if;

  v_failed := false;
  begin perform public.create_pcb(gen_random_uuid(), '2026-Q3', jsonb_build_array(jsonb_build_object('style_id', v_style, 'target_sales', 10)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to call create_pcb'; end if;

  v_failed := false;
  begin perform public.create_ppo(gen_random_uuid(), v_style, 'fob', 10, null);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to call create_ppo'; end if;

  v_failed := false;
  begin perform public.issue_ppo_pos(gen_random_uuid(), jsonb_build_array(jsonb_build_object('po_type','finished','vendor_id',v_vendor,'amount',1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to call issue_ppo_pos'; end if;

  v_failed := false;
  begin insert into public.new_products (name) values ('Sales Cannot Create');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role was able to insert into new_products'; end if;

  reset role;

  -- === ops role: full write chain forecast(ops) -> projection -> lock -> pcb -> ppo -> issue, blocked from forecast(sales) ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text, 'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_forecast('sales', '2026-Q4', null, jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role was able to create a sales-kind forecast'; end if;

  perform public.create_forecast('ops', '2026-Q4', null, jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  v_proj := public.create_projection('2026-Q4', jsonb_build_array(jsonb_build_object('style_id', v_style, 'qty', 100)));
  perform public.lock_projection(v_proj);
  v_pcb := public.create_pcb(v_proj, '2026-Q4', jsonb_build_array(jsonb_build_object('style_id', v_style, 'target_sales', 100, 'ending_stock', 0, 'unit_cost', 1000)));
  v_ppo := public.create_ppo(v_pcb, v_style, 'fob', 100, null);
  perform public.issue_ppo_pos(v_ppo, jsonb_build_array(jsonb_build_object('po_type','finished','vendor_id',v_vendor,'amount',100000)));

  insert into public.new_products (name) values ('Ops Can Create');

  reset role;

  -- === RLS SELECT block: sales sees zero pcb/ppo rows even though they now exist ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text, 'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  select count(*) into v_cnt from public.pcb where id = v_pcb;
  if v_cnt <> 0 then raise exception 'FAIL: sales role could SELECT a pcb row'; end if;
  select count(*) into v_cnt from public.ppo where id = v_ppo;
  if v_cnt <> 0 then raise exception 'FAIL: sales role could SELECT a ppo row'; end if;

  reset role;
  raise notice 'role_access OK: forecast kind guard, projection/pcb/ppo/issue writer guard (incl. security-definer lock_projection), new_products write guard, pcb/ppo SELECT block for sales';
end $$;

rollback;
