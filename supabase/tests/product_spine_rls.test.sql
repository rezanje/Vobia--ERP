set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ps_a@a.test','{"tenant_name":"PS A"}'),
  ('b2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ps_b@b.test','{"tenant_name":"PS B"}');

insert into public.styles (id, tenant_id, code, name)
  values ('c3333333-3333-3333-3333-333333333333',
          (select tenant_id from public.profiles where id='b2222222-2222-2222-2222-222222222222'),
          'B-CODE','B Style');

select set_config('request.jwt.claims',
  json_build_object('sub','a1111111-1111-1111-1111-111111111111','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='a1111111-1111-1111-1111-111111111111'))::text, true);
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.styles;
  if n <> 0 then raise exception 'RLS FAIL: tenant A sees % styles from tenant B', n; end if;
  raise notice 'PS RLS OK: tenant A sees 0 of tenant B styles';
end $$;

rollback;
