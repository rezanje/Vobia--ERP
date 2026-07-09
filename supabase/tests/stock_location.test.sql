set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('c1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','stl@s.test','{"tenant_name":"Stl Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='c1111111-1111-1111-1111-111111111111');
  v_loc uuid;
  v_style uuid; v_sku uuid; v_bal int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','c1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
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

  raise notice 'stock_location OK: default location balance view works';
end $$;

rollback;
