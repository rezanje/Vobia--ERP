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
    claims := jsonb_set(claims, '{role}', to_jsonb(p.role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- the hook runs as supabase_auth_admin: it must execute the fn and read profiles
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant all on table public.profiles to supabase_auth_admin;
create policy "auth admin reads profiles" on public.profiles
  as permissive for select to supabase_auth_admin using (true);
