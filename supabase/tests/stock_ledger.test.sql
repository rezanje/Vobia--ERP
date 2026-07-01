set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('e5555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','sl@s.test','{"tenant_name":"SL Co"}');

select set_config('request.jwt.claims',
  json_build_object('sub','e5555555-5555-5555-5555-555555555555','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='e5555555-5555-5555-5555-555555555555'))::text, true);
set local role authenticated;

do $$
begin
  begin
    insert into public.stock_ledger (tenant_id, sku_id, qty, movement_type, reason)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 5, 'adjustment', 'x');
    raise exception 'expected permission denied on direct insert';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.stock_ledger set qty = 1;
    raise exception 'expected permission denied on update';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.stock_ledger;
    raise exception 'expected permission denied on delete';
  exception when insufficient_privilege then null;
  end;

  raise notice 'append-only OK: direct insert/update/delete denied';
end $$;

rollback;
