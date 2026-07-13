-- General ledger: chart of accounts + double-entry journals.
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  code text not null,
  name text not null,
  type text not null check (type in ('aset','kewajiban','modal','pendapatan','beban')),
  normal_balance text not null check (normal_balance in ('debit','kredit')),
  is_contra boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index accounts_tenant_idx on public.accounts(tenant_id);

create table public.journals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  journal_date date not null default current_date,
  memo text,
  source_type text,
  source_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index journals_tenant_date_idx on public.journals(tenant_id, journal_date desc);
-- idempotency for auto-posting: at most one journal per source event
create unique index journals_source_uq on public.journals(tenant_id, source_type, source_id)
  where source_type is not null and source_id is not null;

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  journal_id uuid not null references public.journals(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  debit numeric(16,2) not null default 0,
  credit numeric(16,2) not null default 0,
  memo text,
  created_at timestamptz not null default now(),
  constraint jl_one_side check (debit >= 0 and credit >= 0 and not (debit > 0 and credit > 0))
);
create index journal_lines_journal_idx on public.journal_lines(journal_id);
create index journal_lines_account_idx on public.journal_lines(account_id);

alter table public.accounts enable row level security;
alter table public.journals enable row level security;
alter table public.journal_lines enable row level security;

create policy tenant_isolation on public.accounts for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- journals/journal_lines are append-only via post_journal(); reads only for authenticated.
create policy tenant_isolation on public.journals for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create policy tenant_isolation on public.journal_lines for select to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

grant select, insert, update, delete on public.accounts to authenticated;
grant select on public.journals to authenticated;
grant select on public.journal_lines to authenticated;
