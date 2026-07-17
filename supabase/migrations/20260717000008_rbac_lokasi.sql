-- RBAC Lokasi increment: gate location WRITES to owner/ops. READ stays
-- tenant-wide (default-location lookup is cross-module: receive/issue/produce).
-- No RPC write path — restrictive RLS is the whole DB gate. Fail-closed.
create policy loc_write_insert on public.locations as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
create policy loc_write_update on public.locations as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','ops'));
create policy loc_write_delete on public.locations as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','ops'));
