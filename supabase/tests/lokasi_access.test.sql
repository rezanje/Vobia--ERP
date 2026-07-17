set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('f1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','loc-owner@s.test','{"tenant_name":"Loc Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='f1111111-1111-1111-1111-111111111111');
  v_ops_uid uuid := 'f2222222-2222-2222-2222-222222222222';
  v_sales_uid uuid := 'f3333333-3333-3333-3333-333333333333';
  v_inv_uid uuid := 'f4444444-4444-4444-4444-444444444444';
  v_cnt int; v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_ops_uid,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','loc-ops@s.test'),
    (v_sales_uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','loc-sales@s.test'),
    (v_inv_uid,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','loc-inv@s.test');
  update public.profiles set tenant_id = v_tenant, role = 'ops'       where id = v_ops_uid;
  update public.profiles set tenant_id = v_tenant, role = 'sales'     where id = v_sales_uid;
  update public.profiles set tenant_id = v_tenant, role = 'inventory' where id = v_inv_uid;

  -- === ops: insert allowed ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ops_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  perform set_config('role','authenticated', true);
  insert into public.locations (name) values ('Gudang Ops');
  reset role;

  -- === sales: insert blocked, read intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  perform set_config('role','authenticated', true);
  v_failed := false;
  begin insert into public.locations (name) values ('Gudang Sales');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: sales role created a location'; end if;
  select count(*) into v_cnt from public.locations where tenant_id = v_tenant;
  if v_cnt < 1 then raise exception 'FAIL: sales role cannot read locations'; end if;
  reset role;

  -- === inventory: insert blocked (view-only), read intact ===
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_inv_uid::text,'role','authenticated','tenant_id',v_tenant::text,'user_role','inventory')::text, true);
  perform set_config('role','authenticated', true);
  v_failed := false;
  begin insert into public.locations (name) values ('Gudang Inv');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: inventory role created a location'; end if;
  select count(*) into v_cnt from public.locations where tenant_id = v_tenant;
  if v_cnt < 1 then raise exception 'FAIL: inventory role cannot read locations'; end if;
  reset role;

  raise notice 'lokasi_access OK: ops writes, sales+inventory blocked on insert + reads intact';
end $$;

rollback;
