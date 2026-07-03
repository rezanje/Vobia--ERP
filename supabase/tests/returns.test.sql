set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a3030303-3030-3030-3030-303030303030','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ret_a@a.test','{"tenant_name":"RET A"}'),
  ('b4040404-4040-4040-4040-404040404040','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ret_b@b.test','{"tenant_name":"RET B"}');

do $$
declare
  v_a uuid := (select tenant_id from public.profiles where id='a3030303-3030-3030-3030-303030303030');
  v_b uuid := (select tenant_id from public.profiles where id='b4040404-4040-4040-4040-404040404040');
  v_b_ch uuid; v_b_ord uuid; v_cnt int;
begin
  insert into public.channels (tenant_id, name) values (v_b, 'B Ch') returning id into v_b_ch;
  insert into public.orders (tenant_id, code, channel_id) values (v_b, 'B-ORD', v_b_ch) returning id into v_b_ord;
  insert into public.returns (tenant_id, code, order_id) values (v_b, 'B-RET', v_b_ord);

  perform set_config('request.jwt.claims',
    json_build_object('sub','a3030303-3030-3030-3030-303030303030','role','authenticated','tenant_id',v_a::text)::text, true);
  perform set_config('role','authenticated', true);

  select count(*) into v_cnt from public.returns;
  if v_cnt <> 0 then raise exception 'RLS FAIL: tenant A sees % returns from B', v_cnt; end if;
  raise notice 'RET RLS OK: tenant A sees 0 of tenant B returns';
end $$;

rollback;
