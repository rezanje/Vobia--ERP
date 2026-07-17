set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('c1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','stl@s.test','{"tenant_name":"Stl Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='c1111111-1111-1111-1111-111111111111');
  v_loc uuid;
  v_loc2 uuid;
  v_style uuid; v_sku uuid; v_bal int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','c1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text,'user_role','owner')::text, true);
  perform set_config('role','authenticated', true);

  v_style := public.create_style_with_skus('STL-1','Stl','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;

  -- movement with no location lands in default location (record_movement v2, Task 4)
  perform public.record_movement(v_sku, 10, 'production_in');
  select balance into v_bal from public.stock_balances_by_location
    where sku_id = v_sku and location_id = v_loc;
  if v_bal <> 10 then raise exception 'expected 10 at default location, got %', v_bal; end if;

  -- explicit location routes there, not to default
  declare v_bal2 int;
  begin
    insert into public.locations (name) values ('Toko Kedua') returning id into v_loc2;
    perform public.record_movement(v_sku, 4, 'production_in', null, null, null, v_loc2);
    select balance into v_bal2 from public.stock_balances_by_location
      where sku_id = v_sku and location_id = v_loc2;
    if v_bal2 <> 4 then raise exception 'expected 4 at Toko Kedua, got %', v_bal2; end if;

    -- default location still holds the original 10
    select balance into v_bal from public.stock_balances_by_location
      where sku_id = v_sku and location_id = v_loc;
    if v_bal <> 10 then raise exception 'expected 10 still at default, got %', v_bal; end if;
  end;

  -- cross-tenant location is rejected
  declare v_foreign_loc uuid;
  begin
    perform set_config('role', null, true); reset role;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      values ('c9999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-000000000000',
              'authenticated','authenticated','stlx@s.test','{"tenant_name":"Stl X"}');
    select id into v_foreign_loc from public.locations
      where tenant_id = (select tenant_id from public.profiles where id='c9999999-9999-9999-9999-999999999999')
        and is_default;
    perform set_config('request.jwt.claims',
      json_build_object('sub','c1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
    perform set_config('role','authenticated', true);
    begin
      perform public.record_movement(v_sku, 1, 'production_in', null, null, null, v_foreign_loc);
      raise exception 'FOREIGN_LOC_SHOULD_FAIL';
    exception when others then
      if sqlerrm not like '%another tenant%' then raise; end if;
    end;
  end;

  -- transfer 6 from default to Toko Kedua conserves the total (14)
  declare v_total_before int; v_total_after int;
  begin
    select coalesce(sum(qty),0) into v_total_before from public.stock_ledger where sku_id = v_sku;
    perform public.record_transfer(v_sku, 6, v_loc, v_loc2, 'pindah toko');
    select coalesce(sum(qty),0) into v_total_after from public.stock_ledger where sku_id = v_sku;
    if v_total_before <> v_total_after then
      raise exception 'transfer changed total: % -> %', v_total_before, v_total_after;
    end if;
    -- default now 4, Toko Kedua now 10
    if (select balance from public.stock_balances_by_location where sku_id=v_sku and location_id=v_loc) <> 4
      then raise exception 'expected 4 at default after transfer'; end if;
    if (select balance from public.stock_balances_by_location where sku_id=v_sku and location_id=v_loc2) <> 10
      then raise exception 'expected 10 at Toko Kedua after transfer'; end if;
  end;

  -- overdraw is rejected (default has 4, ask for 999)
  begin
    perform public.record_transfer(v_sku, 999, v_loc, v_loc2, 'x');
    raise exception 'OVERDRAW_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%insufficient%' then raise; end if;
  end;

  -- from == to is rejected
  begin
    perform public.record_transfer(v_sku, 1, v_loc, v_loc, 'x');
    raise exception 'SAME_LOC_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%differ%' then raise; end if;
  end;

  raise notice 'stock_location OK: default location balance view works';
end $$;

rollback;
