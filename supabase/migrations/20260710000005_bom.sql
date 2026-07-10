create table public.bom_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default (auth.jwt() ->> 'tenant_id')::uuid references public.tenants(id),
  style_id uuid not null references public.styles(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty_per_unit numeric(14,4) not null check (qty_per_unit > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, style_id, material_id)
);
create index bom_lines_style_idx on public.bom_lines(style_id);

alter table public.bom_lines enable row level security;
create policy tenant_isolation on public.bom_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
grant select, insert, update, delete on public.bom_lines to authenticated;

-- ponytail: like `cost_entries`, RLS validates only the row's tenant_id, not
-- that style_id/material_id belong to the tenant -- a caller who knows a
-- foreign uuid could reference it. Accepted (low risk, needs the uuid); add
-- a validating trigger only if it becomes a real vector.
