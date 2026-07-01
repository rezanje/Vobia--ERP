set search_path to extensions, public, auth;
begin;
select plan(3);

select has_table('public','tenants','tenants table exists');
select has_table('public','profiles','profiles table exists');

-- seed two tenants + two profiles bypassing RLS (as postgres).
-- auth.users rows first to satisfy the profiles FK. (No signup trigger yet at
-- this migration, so profiles are inserted manually.)
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@a.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@b.test');
insert into public.tenants (id, name) values
  ('11111111-1111-1111-1111-111111111111','Tenant A'),
  ('22222222-2222-2222-2222-222222222222','Tenant B');
insert into public.profiles (id, tenant_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','owner');

-- act as an authenticated user of Tenant A
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","tenant_id":"11111111-1111-1111-1111-111111111111","role":"owner"}';

select is(
  (select count(*)::int from public.profiles where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'Tenant A cannot read Tenant B profiles'
);

select * from finish();
rollback;
