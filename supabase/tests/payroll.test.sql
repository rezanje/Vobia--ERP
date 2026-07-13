set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('b1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','hr@s.test','{"tenant_name":"HR Co"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='b1111111-1111-1111-1111-111111111111');
  v_run uuid; v_net numeric; v_beban numeric; v_pajak numeric; v_hutang numeric; v_j uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated',
      'user_role','owner','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.employees (tenant_id, name, base_salary) values (v_tenant,'Andi',5000000);
  insert into public.employees (tenant_id, name, base_salary) values (v_tenant,'Sari',4000000);
  -- Tunjangan transport nominal 500k; BPJS 1% potongan; PPh21 200k pajak
  insert into public.pay_components (tenant_id, name, kind, calc, value) values (v_tenant,'Transport','tunjangan','nominal',500000);
  insert into public.pay_components (tenant_id, name, kind, calc, value) values (v_tenant,'BPJS','potongan','persen',1);
  insert into public.pay_components (tenant_id, name, kind, calc, value, is_tax) values (v_tenant,'PPh21','potongan','nominal',200000,true);

  v_run := public.generate_payroll('2026-07');

  -- Andi: gross 5,000,000+500,000=5,500,000; ded BPJS 50,000; tax 200,000; net 5,250,000
  select net into v_net from public.payslips ps join public.employees e on e.id=ps.employee_id
    where ps.run_id=v_run and e.name='Andi';
  if v_net <> 5250000 then raise exception 'FAIL: Andi net = %, expected 5250000', v_net; end if;

  select coalesce(sum(gross),0), coalesce(sum(tax_total),0), coalesce(sum(net+deduction_total),0)
    into v_beban, v_pajak, v_hutang from public.payslips where run_id=v_run;
  if v_beban <> v_pajak + v_hutang then raise exception 'FAIL: beban % <> pajak %+hutang %', v_beban, v_pajak, v_hutang; end if;

  v_j := public.post_payroll(v_run);
  if (select status from public.payroll_runs where id=v_run) <> 'posted' then raise exception 'FAIL: run not posted'; end if;

  -- journal balanced: Beban Gaji debit = pajak+hutang credit
  if (select balance from public.account_balances where tenant_id=v_tenant and account_code='5-1100') <> v_beban then
    raise exception 'FAIL: beban gaji ledger wrong'; end if;
  if (select coalesce(sum(debit),0)-coalesce(sum(credit),0) from public.journal_lines jl
        join public.journals j on j.id=jl.journal_id where j.id=v_j) <> 0 then
    raise exception 'FAIL: payroll journal not balanced'; end if;

  -- cannot post twice
  begin
    perform public.post_payroll(v_run);
    raise exception 'FAIL: double post allowed';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  raise notice 'OK payroll (Andi net=5,250,000, beban=%)', v_beban;
end $$;

rollback;
