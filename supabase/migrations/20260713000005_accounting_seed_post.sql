-- Seed the standard fashion-brand chart of accounts for a tenant (idempotent).
create or replace function public.seed_accounts(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (tenant_id, code, name, type, normal_balance, is_contra) values
    (p_tenant,'1-1100','Kas','aset','debit',false),
    (p_tenant,'1-1200','Bank','aset','debit',false),
    (p_tenant,'1-1210','Piutang Marketplace','aset','debit',false),
    (p_tenant,'1-1300','Persediaan Bahan','aset','debit',false),
    (p_tenant,'1-1310','Barang Dalam Proses','aset','debit',false),
    (p_tenant,'1-1320','Persediaan Barang Jadi','aset','debit',false),
    (p_tenant,'1-1600','Aset Tetap','aset','debit',false),
    (p_tenant,'1-1700','Akumulasi Penyusutan','aset','kredit',true),
    (p_tenant,'2-1100','Hutang Usaha','kewajiban','kredit',false),
    (p_tenant,'2-1200','Hutang Pajak','kewajiban','kredit',false),
    (p_tenant,'2-1300','Hutang Gaji','kewajiban','kredit',false),
    (p_tenant,'3-1000','Modal','modal','kredit',false),
    (p_tenant,'3-1100','Laba Ditahan','modal','kredit',false),
    (p_tenant,'4-1000','Penjualan','pendapatan','kredit',false),
    (p_tenant,'4-1100','Retur Penjualan','pendapatan','debit',true),
    (p_tenant,'5-1000','HPP','beban','debit',false),
    (p_tenant,'5-1100','Beban Gaji','beban','debit',false),
    (p_tenant,'5-1200','Beban Operasional','beban','debit',false),
    (p_tenant,'5-1300','Beban Penyusutan','beban','debit',false)
  on conflict (tenant_id, code) do nothing;
end; $$;

-- Backfill every existing tenant.
do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.seed_accounts(t.id);
  end loop;
end $$;

-- Extend the new-user handler to also seed accounts. Same signature so the
-- on_auth_user_created trigger keeps pointing here; only one call added.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (name)
  values (coalesce(new.raw_user_meta_data->>'tenant_name', 'Tenant'))
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name)
  values (new.id, new_tenant_id, 'owner', new.raw_user_meta_data->>'full_name');

  insert into public.locations (tenant_id, name, is_default)
  values (new_tenant_id, 'Gudang Utama', true);

  perform public.seed_accounts(new_tenant_id);

  return new;
end; $$;

-- Double-entry poster: single writer to journals/journal_lines.
-- p_lines = jsonb array of { account_code, debit, credit, memo? }.
create or replace function public.post_journal(
  p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_journal uuid;
  v_line jsonb;
  v_acc uuid;
  v_debit numeric(16,2);
  v_credit numeric(16,2);
  v_sum_d numeric(16,2) := 0;
  v_sum_c numeric(16,2) := 0;
  v_n int := 0;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'jurnal butuh minimal 2 baris';
  end if;

  -- idempotency: skip if this source already posted
  if p_source_type is not null and p_source_id is not null then
    select id into v_journal from public.journals
      where tenant_id = v_tenant and source_type = p_source_type and source_id = p_source_id;
    if v_journal is not null then return v_journal; end if;
  end if;

  -- validate + total
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);
    if v_debit < 0 or v_credit < 0 then raise exception 'debit/kredit tidak boleh negatif'; end if;
    if v_debit > 0 and v_credit > 0 then raise exception 'satu baris hanya debit atau kredit'; end if;
    v_sum_d := v_sum_d + v_debit;
    v_sum_c := v_sum_c + v_credit;
    v_n := v_n + 1;
  end loop;
  if v_sum_d = 0 and v_sum_c = 0 then raise exception 'jurnal kosong'; end if;
  if v_sum_d <> v_sum_c then
    raise exception 'jurnal tidak seimbang: debit % vs kredit %', v_sum_d, v_sum_c;
  end if;

  insert into public.journals (tenant_id, journal_date, memo, source_type, source_id, created_by)
  values (v_tenant, coalesce(p_date, current_date), p_memo, p_source_type, p_source_id, auth.uid())
  returning id into v_journal;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);
    if v_debit = 0 and v_credit = 0 then continue; end if;  -- skip empty rows
    select id into v_acc from public.accounts
      where tenant_id = v_tenant and code = (v_line ->> 'account_code');
    if v_acc is null then raise exception 'akun tidak ditemukan: %', (v_line ->> 'account_code'); end if;
    insert into public.journal_lines (tenant_id, journal_id, account_id, debit, credit, memo)
    values (v_tenant, v_journal, v_acc, v_debit, v_credit, v_line ->> 'memo');
  end loop;

  return v_journal;
end; $$;

grant execute on function public.seed_accounts(uuid) to authenticated;
grant execute on function public.post_journal(date, text, text, uuid, jsonb) to authenticated;
