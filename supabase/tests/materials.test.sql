set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('b1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','mat@s.test','{"tenant_name":"Mat Co"}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('b2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','mat2@s.test','{"tenant_name":"Mat Other"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='b1111111-1111-1111-1111-111111111111');
  v_other  uuid := (select tenant_id from public.profiles where id='b2222222-2222-2222-2222-222222222222');
begin
  -- seed a material for tenant B as table owner (RLS bypassed) so the
  -- isolation check below has a real cross-tenant row to be blocked from.
  insert into public.materials (tenant_id, code, name, category, uom)
    values (v_other, 'OTH-1', 'Oth', 'fabric', 'm');

  -- act as tenant A
  perform set_config('request.jwt.claims',
    json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.materials (code, name, category, uom) values ('FAB-001','Katun Combed 30s','fabric','m');

  -- category check rejects garbage
  begin
    insert into public.materials (code, name, category, uom) values ('X','Bad','nonsense','m');
    raise exception 'CATEGORY_SHOULD_FAIL';
  exception when check_violation then null;
  end;

  -- RLS: while acting as tenant A, tenant B's material must be invisible
  if exists (select 1 from public.materials where tenant_id = v_other) then
    raise exception 'RLS leak on materials';
  end if;

  reset role;
  raise notice 'materials OK: insert, category check, RLS';
end $$;

rollback;
