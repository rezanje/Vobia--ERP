-- Add 'sales' as a valid app role (Sales-vs-Ops demo simulation).
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','sales','ops','production','inventory','finance','viewer'));
