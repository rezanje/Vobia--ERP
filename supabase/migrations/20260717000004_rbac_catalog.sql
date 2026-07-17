-- RBAC catalog increment: gate catalog WRITES to owner/production/inventory.
-- READ stays tenant-wide (styles/skus/materials read cross-module) — only WRITE
-- is added, per-command, as RESTRICTIVE policies that AND on top of the existing
-- permissive tenant_isolation. Fail-closed: missing user_role claim denies.

-- (1) guard the sole styles/colorways/skus create path
create or replace function public.create_style_with_skus(
  p_code text,
  p_name text,
  p_collection text,
  p_colorways jsonb,
  p_sizes text[],
  p_overrides jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_style_id uuid;
  v_cw jsonb;
  v_color_code text;
  v_cw_id uuid;
  v_size text;
  v_code text;
begin
  if v_tenant is null then
    raise exception 'no tenant_id in JWT';
  end if;
  if coalesce(v_role not in ('owner','production','inventory'), true) then
    raise exception 'hanya role Produksi/Inventory/Owner yang boleh membuat style';
  end if;
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'code and name are required';
  end if;
  if p_colorways is null or jsonb_array_length(p_colorways) < 1 then
    raise exception 'at least one colorway required';
  end if;
  if array_length(p_sizes, 1) is null then
    raise exception 'at least one size required';
  end if;

  insert into public.styles (tenant_id, code, name, collection)
  values (v_tenant, p_code, p_name, nullif(trim(p_collection), ''))
  returning id into v_style_id;

  for v_cw in select value from jsonb_array_elements(p_colorways) loop
    v_color_code := v_cw ->> 'color_code';
    insert into public.colorways (tenant_id, style_id, color_name, color_code)
    values (v_tenant, v_style_id, v_cw ->> 'color_name', v_color_code)
    returning id into v_cw_id;

    foreach v_size in array p_sizes loop
      v_code := coalesce(
        p_overrides ->> (v_color_code || '-' || v_size),
        p_code || '-' || v_color_code || '-' || v_size
      );
      insert into public.skus (tenant_id, colorway_id, size, sku_code)
      values (v_tenant, v_cw_id, v_size, v_code);
    end loop;
  end loop;

  return v_style_id;
end;
$$;

-- (2) RESTRICTIVE write-gates on the directly-written catalog tables.
-- skus: insert (also used by create_style_with_skus — owner/prod/inv allowed there
-- too, so consistent), update (SkuToggle), delete (defensive).
create policy catalog_write_insert on public.skus as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_update on public.skus as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_delete on public.skus as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));

create policy catalog_write_insert on public.materials as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_update on public.materials as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_delete on public.materials as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));

create policy catalog_write_insert on public.bom_lines as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_update on public.bom_lines as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy catalog_write_delete on public.bom_lines as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
