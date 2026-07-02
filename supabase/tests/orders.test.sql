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

rollback;
