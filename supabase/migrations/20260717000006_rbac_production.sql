-- RBAC Produksi increment: gate production writes. READ stays tenant-wide
-- (vendors read by procurement; prod_lines/cost_entries feed the sku_hpp view).
-- Fail-closed: missing user_role claim denies.

-- (1) guard the two production RPCs (create_or_replace preserves existing grants)
create or replace function public.create_production_order(
  p_style_id uuid,
  p_vendor_id uuid,
  p_deadline date,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'PO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_po uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','production'), true) then
    raise exception 'hanya role Produksi/Owner yang boleh membuat order produksi';
  end if;
  if not exists (select 1 from public.styles where id = p_style_id and tenant_id = v_tenant) then
    raise exception 'style not in tenant';
  end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id and tenant_id = v_tenant) then
    raise exception 'vendor not in tenant';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then
    raise exception 'at least one line required';
  end if;

  insert into public.production_orders (tenant_id, code, style_id, vendor_id, deadline, notes)
  values (v_tenant, v_code, p_style_id, p_vendor_id, p_deadline, nullif(trim(p_notes), ''))
  returning id into v_po;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_sku := (v_line ->> 'sku_id')::uuid;
    select tenant_id into v_sku_tenant from public.skus where id = v_sku;
    if v_sku_tenant is null or v_sku_tenant <> v_tenant then raise exception 'sku not in tenant'; end if;
    if (v_line ->> 'qty_ordered')::int <= 0 then raise exception 'qty_ordered must be > 0'; end if;
    insert into public.prod_lines (tenant_id, po_id, sku_id, qty_ordered)
    values (v_tenant, v_po, v_sku, (v_line ->> 'qty_ordered')::int);
  end loop;

  return v_po;
end; $$;

create or replace function public.transition_production_stage(
  p_po_id uuid,
  p_next_stage text
) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_current text;
  v_ok boolean;
  v_line record;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','production'), true) then
    raise exception 'hanya role Produksi/Owner yang boleh mengubah stage produksi';
  end if;
  select stage into v_current from public.production_orders where id = p_po_id;
  if v_current is null then raise exception 'production order not found'; end if;

  v_ok := case
    when v_current = 'trial' and p_next_stage in ('mass_production','canceled') then true
    when v_current = 'mass_production' and p_next_stage in ('qc','canceled') then true
    when v_current = 'qc' and p_next_stage in ('completed','mass_production','canceled') then true
    else false
  end;
  if not v_ok then raise exception 'illegal transition % -> %', v_current, p_next_stage; end if;

  if p_next_stage = 'completed' then
    for v_line in
      select id, sku_id, qty_received from public.prod_lines
      where po_id = p_po_id and qty_received > 0
    loop
      perform public.record_movement(v_line.sku_id, v_line.qty_received, 'production_in', null, 'production_line', v_line.id);
    end loop;
  end if;

  update public.production_orders set stage = p_next_stage where id = p_po_id;
end; $$;

-- (2) RESTRICTIVE write-gates. production_orders/prod_lines -> owner/production
create policy prod_write_insert on public.production_orders as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production'));
create policy prod_write_update on public.production_orders as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production'));
create policy prod_write_delete on public.production_orders as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production'));

create policy prod_write_insert on public.prod_lines as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production'));
create policy prod_write_update on public.prod_lines as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production'));
create policy prod_write_delete on public.prod_lines as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production'));

-- vendors -> owner/production/ops (master data used by procurement too)
create policy prod_write_insert on public.vendors as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','ops'));
create policy prod_write_update on public.vendors as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','ops'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','ops'));
create policy prod_write_delete on public.vendors as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','ops'));

-- cost_entries -> owner/production/inventory (HPP)
create policy prod_write_insert on public.cost_entries as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy prod_write_update on public.cost_entries as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
create policy prod_write_delete on public.cost_entries as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','production','inventory'));
