create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (name)
  values (coalesce(new.raw_user_meta_data->>'tenant_name', 'Tenant'))
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name)
  values (new.id, new_tenant_id, 'owner', new.raw_user_meta_data->>'full_name');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
