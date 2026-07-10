set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('d1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','mled@s.test','{"tenant_name":"MLed Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='d1111111-1111-1111-1111-111111111111');
begin
  -- append-only: direct writes denied to authenticated
  perform set_config('request.jwt.claims',
    json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);
  begin
    insert into public.material_ledger (tenant_id, material_id, location_id, qty, movement_type)
    values (v_tenant, gen_random_uuid(), gen_random_uuid(), 5, 'purchase_in');
    raise exception 'expected permission denied on direct insert';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'material_ledger OK: append-only enforced';
end $$;

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='d1111111-1111-1111-1111-111111111111');
  v_mat uuid; v_loc uuid; v_bal numeric;
  v_other_tenant uuid; v_other_mat uuid;
begin
  -- foreign tenant + material for cross-tenant check
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
    values ('d2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
            'authenticated','authenticated','mled2@s.test','{"tenant_name":"MLed Other"}');
  v_other_tenant := (select tenant_id from public.profiles where id='d2222222-2222-2222-2222-222222222222');
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_other_tenant, 'OTH-FAB', 'Oth', 'fabric', 'm') returning id into v_other_mat;

  perform set_config('request.jwt.claims',
    json_build_object('sub','d1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_tenant, 'FAB-30S', 'Katun', 'fabric', 'm') returning id into v_mat;
  select id into v_loc from public.locations where tenant_id = v_tenant and is_default;

  -- purchase_in with no location → default; positive
  perform public.record_material_movement(v_mat, 100, 'purchase_in');
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 100 then raise exception 'expected 100 at default, got %', v_bal; end if;

  -- issue_out stored negative
  perform public.record_material_movement(v_mat, 30, 'issue_out', null, null, null, v_loc);
  select balance into v_bal from public.material_balances_by_location where material_id = v_mat and location_id = v_loc;
  if v_bal <> 70 then raise exception 'expected 70 after issue, got %', v_bal; end if;

  -- adjustment requires reason
  begin
    perform public.record_material_movement(v_mat, 5, 'adjustment');
    raise exception 'ADJ_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%requires a reason%' then raise; end if;
  end;

  -- cross-tenant material rejected
  begin
    perform public.record_material_movement(v_other_mat, 5, 'purchase_in');
    raise exception 'XT_SHOULD_FAIL';
  exception when others then
    if sqlerrm not like '%another tenant%' then raise; end if;
  end;

  raise notice 'record_material_movement OK: default loc, signs, reason, cross-tenant';
end $$;

rollback;
