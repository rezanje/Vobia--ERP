-- Fix: the previous hook wrote the app role into the reserved `role` claim,
-- which PostgREST uses to SET ROLE for the request -> "role \"owner\" does not
-- exist" (401) on every data request. Put the app role in a separate
-- `user_role` claim and leave `role` (authenticated/anon) untouched.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event->'claims';
  p record;
begin
  select tenant_id, role into p
  from public.profiles
  where id = (event->>'user_id')::uuid;

  if p.tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(p.tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(p.role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;
