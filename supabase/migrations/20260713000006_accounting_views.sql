-- Flat ledger view: one row per journal line, enriched with account + date.
-- Report pages aggregate this (with optional date filters) for trial balance,
-- income statement, and balance sheet.
create view public.ledger_entries with (security_invoker = on) as
select
  jl.tenant_id,
  j.id as journal_id,
  j.journal_date,
  j.memo as journal_memo,
  j.source_type,
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  a.type as account_type,
  a.normal_balance,
  a.is_contra,
  jl.debit,
  jl.credit,
  jl.memo as line_memo
from public.journal_lines jl
join public.journals j on j.id = jl.journal_id
join public.accounts a on a.id = jl.account_id;

grant select on public.ledger_entries to authenticated;

-- All-time balance per account (debit-positive). For trial balance + balance sheet.
create view public.account_balances with (security_invoker = on) as
select
  a.tenant_id,
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  a.type as account_type,
  a.normal_balance,
  a.is_contra,
  coalesce(sum(jl.debit), 0) as total_debit,
  coalesce(sum(jl.credit), 0) as total_credit,
  coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0) as balance
from public.accounts a
left join public.journal_lines jl on jl.account_id = a.id
group by a.tenant_id, a.id, a.code, a.name, a.type, a.normal_balance, a.is_contra;

grant select on public.account_balances to authenticated;
