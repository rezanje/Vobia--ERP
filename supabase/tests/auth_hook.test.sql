set search_path to extensions, public, auth;
begin;
select plan(2);

insert into public.tenants (id, name)
  values ('33333333-3333-3333-3333-333333333333','Hooked');
insert into auth.users (id, instance_id, aud, role, email)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','d@d.test');
-- overwrite the trigger-created profile to a known tenant
update public.profiles
  set tenant_id='33333333-3333-3333-3333-333333333333', role='ops'
  where id='dddddddd-dddd-dddd-dddd-dddddddddddd';

select is(
  public.custom_access_token_hook(
    '{"user_id":"dddddddd-dddd-dddd-dddd-dddddddddddd","claims":{}}'::jsonb
  ) -> 'claims' ->> 'tenant_id',
  '33333333-3333-3333-3333-333333333333',
  'hook injects tenant_id claim');

select is(
  public.custom_access_token_hook(
    '{"user_id":"dddddddd-dddd-dddd-dddd-dddddddddddd","claims":{}}'::jsonb
  ) -> 'claims' ->> 'role',
  'ops',
  'hook injects role claim');

select * from finish();
rollback;
