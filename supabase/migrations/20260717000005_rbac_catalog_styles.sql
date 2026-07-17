-- Close the styles/colorways direct-write gap: gate WRITE to owner/production/
-- inventory (matches skus/materials/bom_lines in 20260717000004). READ untouched.
create policy catalog_write_insert on public.styles as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_update on public.styles as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_delete on public.styles as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));

create policy catalog_write_insert on public.colorways as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_update on public.colorways as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_delete on public.colorways as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
