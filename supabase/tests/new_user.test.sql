set search_path to extensions, public, auth;
begin;
select plan(2);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','c@c.test',
        '{"tenant_name":"Acme","full_name":"Cee"}');

select is(
  (select count(*)::int from public.profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1, 'profile auto-created on signup');

select is(
  (select t.name from public.tenants t
     join public.profiles p on p.tenant_id = t.id
     where p.id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'Acme', 'tenant created from user metadata');

select * from finish();
rollback;
