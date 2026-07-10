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

rollback;
