set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('ac111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','acct@s.test','{"tenant_name":"Acct Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='ac111111-1111-1111-1111-111111111111');
  v_j uuid; v_j2 uuid; v_td numeric; v_tc numeric;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','ac111111-1111-1111-1111-111111111111','role','authenticated',
      'user_role','owner','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  -- accounts seeded by handle_new_user
  if (select count(*) from public.accounts where tenant_id=v_tenant) < 15 then
    raise exception 'FAIL: chart of accounts not seeded'; end if;

  -- balanced journal posts
  v_j := public.post_journal(current_date, 'test balanced', 'test', gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object('account_code','1-1100','debit',1000),
      jsonb_build_object('account_code','3-1000','credit',1000)));
  if v_j is null then raise exception 'FAIL: balanced journal not posted'; end if;

  -- unbalanced journal rejected
  begin
    perform public.post_journal(current_date, 'bad', 'test', gen_random_uuid(),
      jsonb_build_array(
        jsonb_build_object('account_code','1-1100','debit',1000),
        jsonb_build_object('account_code','3-1000','credit',900)));
    raise exception 'FAIL: unbalanced journal should be rejected';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- idempotent per source
  v_j2 := public.post_journal(current_date, 'again', 'test-idem', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    jsonb_build_array(
      jsonb_build_object('account_code','1-1100','debit',500),
      jsonb_build_object('account_code','3-1000','credit',500)));
  if public.post_journal(current_date, 'again2', 'test-idem', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    jsonb_build_array(
      jsonb_build_object('account_code','1-1100','debit',500),
      jsonb_build_object('account_code','3-1000','credit',500))) <> v_j2 then
    raise exception 'FAIL: source not idempotent'; end if;

  -- trial balance stays balanced
  select coalesce(sum(total_debit),0), coalesce(sum(total_credit),0)
    into v_td, v_tc from public.account_balances where tenant_id=v_tenant;
  if v_td <> v_tc then raise exception 'FAIL: trial balance off: D% C%', v_td, v_tc; end if;

  raise notice 'OK accounting';
end $$;

rollback;
