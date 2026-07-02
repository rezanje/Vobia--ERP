set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a1010101-1010-1010-1010-101010101010','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ord_a@a.test','{"tenant_name":"ORD A"}'),
  ('b2020202-2020-2020-2020-202020202020','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ord_b@b.test','{"tenant_name":"ORD B"}');

insert into public.channels (tenant_id, name)
  values ((select tenant_id from public.profiles where id='b2020202-2020-2020-2020-202020202020'), 'B Channel');

select set_config('request.jwt.claims',
  json_build_object('sub','a1010101-1010-1010-1010-101010101010','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='a1010101-1010-1010-1010-101010101010'))::text, true);
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.channels;
  if n <> 0 then raise exception 'RLS FAIL: tenant A sees % channels from B', n; end if;
  raise notice 'ORD RLS OK: tenant A sees 0 of tenant B channels';
end $$;

do $$
declare
  v_tenant uuid := (current_setting('request.jwt.claims')::json->>'tenant_id')::uuid;
  v_channel uuid; v_style uuid; v_sku uuid; v_order uuid; v_bal int; v_lines int;
begin
  insert into public.channels (tenant_id, name) values (v_tenant, 'Shopee') returning id into v_channel;
  v_style := public.create_style_with_skus('ORD-STY','ORD Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  perform public.record_movement(v_sku, 100, 'production_in');

  v_order := public.create_order(v_channel, current_date, 'Budi', '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 30, 'unit_price', 50000)));
  select count(*) into v_lines from public.order_lines where order_id = v_order;
  if v_lines <> 1 then raise exception 'expected 1 line, got %', v_lines; end if;
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 70 then raise exception 'expected balance 70, got %', v_bal; end if;

  perform public.create_order(v_channel, current_date, 'Ani', '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 100, 'unit_price', 50000)));
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> -30 then raise exception 'expected balance -30, got %', v_bal; end if;

  begin
    perform public.create_order(gen_random_uuid(), current_date, '', '',
      jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1, 'unit_price', 0)));
    raise exception 'CH_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%channel not in tenant%' then raise; end if; end;

  raise notice 'orders OK: sale_out 70 -> -30 oversell, channel guard';
end $$;

rollback;
