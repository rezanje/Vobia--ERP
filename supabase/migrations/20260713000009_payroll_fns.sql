-- Generate a draft payroll run: one payslip per active employee, applying
-- active pay components (tunjangan / potongan / pajak).
create or replace function public.generate_payroll(p_period text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_run uuid;
  v_emp record;
  v_comp record;
  v_ps uuid;
  v_amt numeric;
  v_tunj numeric; v_ded numeric; v_tax numeric;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_period is null or trim(p_period) = '' then raise exception 'periode wajib'; end if;
  if exists (select 1 from public.payroll_runs where tenant_id = v_tenant and period = p_period) then
    raise exception 'proses gaji periode % sudah ada', p_period;
  end if;

  insert into public.payroll_runs (tenant_id, period) values (v_tenant, p_period) returning id into v_run;

  for v_emp in select * from public.employees where tenant_id = v_tenant and active loop
    v_tunj := 0; v_ded := 0; v_tax := 0;
    insert into public.payslips (tenant_id, run_id, employee_id, base_salary)
      values (v_tenant, v_run, v_emp.id, v_emp.base_salary) returning id into v_ps;

    for v_comp in select * from public.pay_components where tenant_id = v_tenant and active loop
      v_amt := case when v_comp.calc = 'persen' then round(v_emp.base_salary * v_comp.value / 100, 2) else v_comp.value end;
      if v_amt = 0 then continue; end if;
      if v_comp.kind = 'tunjangan' then
        v_tunj := v_tunj + v_amt;
        insert into public.payslip_lines (tenant_id, payslip_id, label, kind, amount)
          values (v_tenant, v_ps, v_comp.name, 'tunjangan', v_amt);
      elsif v_comp.is_tax then
        v_tax := v_tax + v_amt;
        insert into public.payslip_lines (tenant_id, payslip_id, label, kind, amount)
          values (v_tenant, v_ps, v_comp.name, 'pajak', v_amt);
      else
        v_ded := v_ded + v_amt;
        insert into public.payslip_lines (tenant_id, payslip_id, label, kind, amount)
          values (v_tenant, v_ps, v_comp.name, 'potongan', v_amt);
      end if;
    end loop;

    update public.payslips set tunjangan_total = v_tunj, deduction_total = v_ded, tax_total = v_tax where id = v_ps;
  end loop;

  return v_run;
end; $$;
grant execute on function public.generate_payroll(text) to authenticated;

-- Post a draft payroll run to the ledger and mark it posted.
create or replace function public.post_payroll(p_run_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_period text; v_status text;
  v_beban numeric; v_pajak numeric; v_hutang numeric;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select period, status into v_period, v_status from public.payroll_runs
    where id = p_run_id and tenant_id = v_tenant;
  if v_period is null then raise exception 'proses gaji tidak ditemukan'; end if;
  if v_status <> 'draft' then raise exception 'proses gaji sudah diposting'; end if;

  select coalesce(sum(gross),0), coalesce(sum(tax_total),0), coalesce(sum(net + deduction_total),0)
    into v_beban, v_pajak, v_hutang from public.payslips where run_id = p_run_id;
  if v_beban <= 0 then raise exception 'tidak ada gaji untuk diposting'; end if;

  v_lines := v_lines || jsonb_build_object('account_code','5-1100','debit',v_beban,'memo','Beban gaji '||v_period);
  if v_pajak  > 0 then v_lines := v_lines || jsonb_build_object('account_code','2-1200','credit',v_pajak); end if;
  if v_hutang > 0 then v_lines := v_lines || jsonb_build_object('account_code','2-1300','credit',v_hutang); end if;

  v_journal := public._post_journal(v_tenant, auth.uid(), current_date, 'Gaji '||v_period, 'payroll', p_run_id, v_lines);

  update public.payroll_runs set status = 'posted', journal_id = v_journal, posted_at = now() where id = p_run_id;
  return v_journal;
end; $$;
grant execute on function public.post_payroll(uuid) to authenticated;
