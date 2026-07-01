-- Tenant isolation proof.
-- Seeds two users (the signup trigger auto-creates a tenant + owner profile for
-- each), then assumes Tenant A's identity via a JWT claim and asserts that RLS
-- hides every other tenant's profile. Raises an exception on any leak, so the
-- test runner surfaces a failure. Rolled back at the end.
set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@a.test','{"tenant_name":"Tenant A"}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@b.test','{"tenant_name":"Tenant B"}');

-- become an authenticated user of Tenant A; the claim carries A's real
-- (trigger-created) tenant_id, read here while still the privileged role.
select set_config('request.jwt.claims',
  json_build_object(
    'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'role','owner',
    'tenant_id',(select tenant_id::text from public.profiles where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  )::text, true);
set local role authenticated;

do $$
declare
  own_cnt int;
  leak_cnt int;
  my_tenant uuid := (current_setting('request.jwt.claims')::json->>'tenant_id')::uuid;
begin
  select count(*) into own_cnt  from public.profiles;
  select count(*) into leak_cnt from public.profiles where tenant_id <> my_tenant;
  if own_cnt <> 1 then
    raise exception 'RLS FAIL: expected exactly 1 visible (own) profile, got %', own_cnt;
  end if;
  if leak_cnt <> 0 then
    raise exception 'RLS FAIL: % cross-tenant profiles visible to Tenant A', leak_cnt;
  end if;
  raise notice 'RLS OK: own=% leak=%', own_cnt, leak_cnt;
end $$;

rollback;
