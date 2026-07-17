set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('a1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','loc@s.test','{"tenant_name":"Loc Co"}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('a2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','loc2@s.test','{"tenant_name":"Loc Other"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='a1111111-1111-1111-1111-111111111111');
  v_other  uuid := (select tenant_id from public.profiles where id='a2222222-2222-2222-2222-222222222222');
  v_cnt int;
begin
  -- new-user hook seeded exactly one default location per tenant
  select count(*) into v_cnt from public.locations where tenant_id = v_tenant and is_default;
  if v_cnt <> 1 then raise exception 'expected 1 default location for tenant, got %', v_cnt; end if;

  -- RLS: acting as tenant A cannot see tenant B's locations
  perform set_config('request.jwt.claims',
    json_build_object('sub','a1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text,'user_role','owner')::text, true);
  perform set_config('role','authenticated', true);
  if exists (select 1 from public.locations where tenant_id = v_other) then
    raise exception 'RLS leak: tenant A sees tenant B locations';
  end if;

  -- can insert own-tenant location
  insert into public.locations (name) values ('Toko Bandung');
  reset role;
  raise notice 'locations OK: default seeded, RLS isolated, insert works';
end $$;

rollback;
