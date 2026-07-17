set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('e1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','sell-owner@s.test','{"tenant_name":"Sell Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='e1111111-1111-1111-1111-111111111111');
  v_sales_uid uuid := 'e2222222-2222-2222-2222-222222222222';
  v_ops_uid uuid := 'e3333333-3333-3333-3333-333333333333';
  v_ch uuid; v_style uuid; v_cw uuid; v_sku uuid; v_seed_order uuid; v_loc uuid;
  v_order uuid; v_cnt int; v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_sales_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sell-s@s.test'),
    (v_ops_uid,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sell-o@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'sales' where id = v_sales_uid;
  update public.profiles set tenant_id = v_tenant, role = 'ops'   where id = v_ops_uid;

  -- base data as postgres (RLS bypassed)
  insert into public.channels (tenant_id, name) values (v_tenant, 'Seed Channel') returning id into v_ch;
  insert into public.styles (tenant_id, code, name) values (v_tenant,'SEL-01','Sell Style') returning id into v_style;
  insert into public.colorways (tenant_id, style_id, color_name, color_code) values (v_tenant, v_style, 'Black','BLK') returning id into v_cw;
  insert into public.skus (tenant_id, colorway_id, size, sku_code) values (v_tenant, v_cw, 'M','SEL-01-BLK-M') returning id into v_sku;
  -- a seed order (for the return test) + its stock so sale_out doesn't underflow
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
  insert into public.stock_ledger (tenant_id, sku_id, location_id, qty, movement_type, reason)
    values (v_tenant, v_sku, v_loc, 100, 'adjustment', 'seed stock for penjualan_access test');
  insert into public.orders (tenant_id, code, channel_id, order_date) values (v_tenant,'ORD-SEED', v_ch, current_date) returning id into v_seed_order;

  -- === sales role: order + channel + return writes allowed ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);

  v_order := public.create_order(v_ch, null, 'Cust', null, jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 3, 'unit_price', 50000)));
  insert into public.channels (tenant_id, name) values (v_tenant, 'Sales Channel');  -- allowed
  perform public.create_return(v_order, null, 'defect', null, jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1)));

  reset role;

  -- === ops role: all three sales writes blocked, reads intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);

  v_failed := false;
  begin perform public.create_order(v_ch, null, 'X', null, jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1, 'unit_price', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role created an order'; end if;

  v_failed := false;
  begin insert into public.channels (tenant_id, name) values (v_tenant, 'Ops Channel');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role created a channel'; end if;

  v_failed := false;
  begin perform public.create_return(v_order, null, 'x', null, jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1)));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: ops role created a return'; end if;

  -- reads intact
  select count(*) into v_cnt from public.orders where id = v_order;
  if v_cnt <> 1 then raise exception 'FAIL: ops role cannot read orders'; end if;
  select count(*) into v_cnt from public.channels where id = v_ch;
  if v_cnt <> 1 then raise exception 'FAIL: ops role cannot read channels'; end if;

  reset role;
  raise notice 'penjualan_access OK: sales writes order/channel/return, ops blocked on all + reads intact';
end $$;

rollback;
