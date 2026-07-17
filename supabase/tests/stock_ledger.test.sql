set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('e5555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','sl@s.test','{"tenant_name":"SL Co"}');

select set_config('request.jwt.claims',
  json_build_object('sub','e5555555-5555-5555-5555-555555555555','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='e5555555-5555-5555-5555-555555555555'))::text, true);
set local role authenticated;

do $$
begin
  begin
    insert into public.stock_ledger (tenant_id, sku_id, qty, movement_type, reason)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 5, 'adjustment', 'x');
    raise exception 'expected permission denied on direct insert';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.stock_ledger set qty = 1;
    raise exception 'expected permission denied on update';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.stock_ledger;
    raise exception 'expected permission denied on delete';
  exception when insufficient_privilege then null;
  end;

  raise notice 'append-only OK: direct insert/update/delete denied';
end $$;

reset role;
do $$
declare
  v_tenant_a uuid := (select tenant_id from public.profiles where id='e5555555-5555-5555-5555-555555555555');
  v_style uuid; v_sku uuid; v_bal int;
  v_other_tenant uuid; v_other_style uuid; v_other_cw uuid; v_other_sku uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
    values ('f6666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-000000000000',
            'authenticated','authenticated','sl_other@s.test','{"tenant_name":"SL Other"}');
  v_other_tenant := (select tenant_id from public.profiles where id='f6666666-6666-6666-6666-666666666666');
  insert into public.styles (tenant_id, code, name) values (v_other_tenant,'OTH','Oth') returning id into v_other_style;
  insert into public.colorways (tenant_id, style_id, color_name, color_code)
    values (v_other_tenant, v_other_style,'Red','RED') returning id into v_other_cw;
  insert into public.skus (tenant_id, colorway_id, size, sku_code)
    values (v_other_tenant, v_other_cw,'M','OTH-RED-M') returning id into v_other_sku;

  perform set_config('request.jwt.claims',
    json_build_object('sub','e5555555-5555-5555-5555-555555555555','role','authenticated','tenant_id',v_tenant_a::text,'user_role','owner')::text, true);
  perform set_config('role','authenticated', true);

  v_style := public.create_style_with_skus('SL-STY','SL Style','',
    '[{"color_name":"Black","color_code":"BLK"}]'::jsonb, array['M'], '{}'::jsonb);
  select k.id into v_sku from public.skus k
    join public.colorways c on c.id = k.colorway_id where c.style_id = v_style limit 1;

  perform public.record_movement(v_sku, 10, 'production_in');
  perform public.record_movement(v_sku, 3, 'sale_out');
  select balance into v_bal from public.stock_balances where sku_id = v_sku;
  if v_bal <> 7 then raise exception 'expected balance 7, got %', v_bal; end if;
  if not exists (select 1 from public.stock_ledger where sku_id = v_sku and movement_type='sale_out' and qty = -3) then
    raise exception 'sale_out not stored as -3';
  end if;

  begin
    perform public.record_movement(v_sku, 5, 'adjustment');
    raise exception 'ADJ_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%requires a reason%' then raise; end if;
  end;

  begin
    perform public.record_movement(v_other_sku, 5, 'production_in');
    raise exception 'XT_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%another tenant%' then raise; end if;
  end;

  raise notice 'record_movement OK: balance 7, sign, adjustment-reason, cross-tenant enforced';
end $$;

rollback;
