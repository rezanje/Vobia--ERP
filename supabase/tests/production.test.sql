set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a7777777-7777-7777-7777-777777777777','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pv_a@a.test','{"tenant_name":"PV A"}'),
  ('b8888888-8888-8888-8888-888888888888','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pv_b@b.test','{"tenant_name":"PV B"}');

insert into public.vendors (tenant_id, name)
  values ((select tenant_id from public.profiles where id='b8888888-8888-8888-8888-888888888888'), 'B Vendor');

select set_config('request.jwt.claims',
  json_build_object('sub','a7777777-7777-7777-7777-777777777777','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='a7777777-7777-7777-7777-777777777777'))::text, true);
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.vendors;
  if n <> 0 then raise exception 'RLS FAIL: tenant A sees % vendors from B', n; end if;
  raise notice 'PV RLS OK: tenant A sees 0 of tenant B vendors';
end $$;

rollback;
