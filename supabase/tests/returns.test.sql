set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a3030303-3030-3030-3030-303030303030','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ret_a@a.test','{"tenant_name":"RET A"}'),
  ('b4040404-4040-4040-4040-404040404040','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ret_b@b.test','{"tenant_name":"RET B"}');

do $$
declare
  v_a uuid := (select tenant_id from public.profiles where id='a3030303-3030-3030-3030-303030303030');
  v_b uuid := (select tenant_id from public.profiles where id='b4040404-4040-4040-4040-404040404040');
  v_b_ch uuid; v_b_ord uuid; v_cnt int;
begin
  insert into public.channels (tenant_id, name) values (v_b, 'B Ch') returning id into v_b_ch;
  insert into public.orders (tenant_id, code, channel_id) values (v_b, 'B-ORD', v_b_ch) returning id into v_b_ord;
  insert into public.returns (tenant_id, code, order_id) values (v_b, 'B-RET', v_b_ord);

  perform set_config('request.jwt.claims',
    json_build_object('sub','a3030303-3030-3030-3030-303030303030','role','authenticated','tenant_id',v_a::text)::text, true);
  perform set_config('role','authenticated', true);

  select count(*) into v_cnt from public.returns;
  if v_cnt <> 0 then raise exception 'RLS FAIL: tenant A sees % returns from B', v_cnt; end if;
  raise notice 'RET RLS OK: tenant A sees 0 of tenant B returns';
end $$;

do $$
declare
  v_a uuid := (current_setting('request.jwt.claims')::json->>'tenant_id')::uuid;
  v_channel uuid; v_style uuid; v_sku uuid; v_order uuid; v_ret uuid; v_bal int; v_lines int;
begin
  insert into public.channels (tenant_id, name) values (v_a, 'Shopee') returning id into v_channel;
  v_style := public.create_style_with_skus('RET-STY','RET Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  perform public.record_movement(v_sku, 100, 'production_in');
  v_order := public.create_order(v_channel, current_date, '', '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 30, 'unit_price', 0)));
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 70 then raise exception 'expected balance 70 after sale, got %', v_bal; end if;

  v_ret := public.create_return(v_order, current_date, 'defect', '',
    jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 10)));
  select count(*) into v_lines from public.return_lines where return_id = v_ret;
  if v_lines <> 1 then raise exception 'expected 1 return line, got %', v_lines; end if;
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 80 then raise exception 'expected balance 80 after return, got %', v_bal; end if;

  begin
    perform public.create_return(gen_random_uuid(), current_date, '', '',
      jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty', 1)));
    raise exception 'ORD_SHOULD_FAIL';
  exception when others then if sqlerrm not like '%order not in tenant%' then raise; end if; end;

  raise notice 'returns OK: return_in 70 -> 80, order guard';
end $$;

rollback;
