-- Role-gate PCB/PPO entirely: sales has zero access (read or write) per the
-- access matrix. owner/ops keep full read+write. Both USING and WITH CHECK
-- carry the same tenant+role condition, replacing the old tenant-only policy.
drop policy tenant_isolation on public.pcb;
create policy tenant_isolation on public.pcb for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'));

drop policy tenant_isolation on public.pcb_lines;
create policy tenant_isolation on public.pcb_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'));

drop policy tenant_isolation on public.ppo;
create policy tenant_isolation on public.ppo for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','ops'));

-- Forecast/Proyeksi family: readable+writable at the RLS layer by owner/sales/ops
-- (the fine-grained "which kind can sales/ops write" nuance is enforced inside
-- create_forecast/create_projection/lock_projection from Task 2, not here).
drop policy tenant_isolation on public.forecasts;
create policy tenant_isolation on public.forecasts for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'));

drop policy tenant_isolation on public.forecast_lines;
create policy tenant_isolation on public.forecast_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'));

drop policy tenant_isolation on public.projections;
create policy tenant_isolation on public.projections for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'));

drop policy tenant_isolation on public.projection_lines;
create policy tenant_isolation on public.projection_lines for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'))
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and (auth.jwt() ->> 'user_role') in ('owner','sales','ops'));

-- new_products: SELECT stays open to the whole tenant (sales can view, per
-- matrix 👁) via the existing tenant_isolation policy, untouched. Add a
-- RESTRICTIVE policy that narrows INSERT/UPDATE to owner/ops only — restrictive
-- policies AND on top of the permissive tenant_isolation policy, so this adds
-- a role requirement without reopening or changing read access.
create policy write_role_gate on public.new_products as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
create policy write_role_gate on public.new_products as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));

-- po_payments: same technique — SELECT untouched, write narrowed to owner/ops.
create policy write_role_gate on public.po_payments as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
create policy write_role_gate on public.po_payments as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
