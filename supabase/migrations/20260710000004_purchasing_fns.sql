create or replace function public.create_purchase_order(
  p_vendor_id uuid,
  p_location_id uuid,
  p_order_date date,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text := 'PB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_po uuid;
  v_line jsonb;
  v_mat uuid;
  v_mat_tenant uuid;
  v_loc uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id and tenant_id = v_tenant) then
    raise exception 'vendor not in tenant';
  end if;
  if p_location_id is null then
    select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
    if v_loc is null then raise exception 'no default location'; end if;
  else
    if not exists (select 1 from public.locations where id = p_location_id and tenant_id = v_tenant) then
      raise exception 'location not in tenant';
    end if;
    v_loc := p_location_id;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then raise exception 'at least one line required'; end if;

  insert into public.purchase_orders (tenant_id, code, vendor_id, location_id, order_date, notes)
  values (v_tenant, v_code, p_vendor_id, v_loc, coalesce(p_order_date, current_date), nullif(trim(p_notes), ''))
  returning id into v_po;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_mat := (v_line ->> 'material_id')::uuid;
    select tenant_id into v_mat_tenant from public.materials where id = v_mat;
    if v_mat_tenant is null or v_mat_tenant <> v_tenant then raise exception 'material not in tenant'; end if;
    if (v_line ->> 'qty_ordered')::numeric <= 0 then raise exception 'qty_ordered must be > 0'; end if;
    insert into public.purchase_lines (tenant_id, po_id, material_id, qty_ordered, unit_price)
    values (v_tenant, v_po, v_mat, (v_line ->> 'qty_ordered')::numeric, coalesce((v_line ->> 'unit_price')::numeric, 0));
  end loop;

  return v_po;
end;
$$;

grant execute on function public.create_purchase_order(uuid, uuid, date, text, jsonb) to authenticated;

create or replace function public.receive_purchase(
  p_po_id uuid,
  p_receipts jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_status text;
  v_loc uuid;
  v_rec jsonb;
  v_line public.purchase_lines;
  v_qty numeric;
  v_all_full boolean;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select status, location_id into v_status, v_loc from public.purchase_orders
    where id = p_po_id and tenant_id = v_tenant;
  if v_status is null then raise exception 'purchase order not found'; end if;
  if v_status = 'canceled' then raise exception 'cannot receive a canceled PO'; end if;
  if p_receipts is null or jsonb_array_length(p_receipts) < 1 then raise exception 'no receipts'; end if;

  for v_rec in select value from jsonb_array_elements(p_receipts) loop
    v_qty := (v_rec ->> 'qty')::numeric;
    if v_qty <= 0 then raise exception 'receipt qty must be > 0'; end if;
    select * into v_line from public.purchase_lines
      where id = (v_rec ->> 'line_id')::uuid and po_id = p_po_id and tenant_id = v_tenant;
    if v_line.id is null then raise exception 'line not in PO'; end if;
    if v_line.qty_received + v_qty > v_line.qty_ordered then
      raise exception 'over-receipt on line %: % + % > %', v_line.id, v_line.qty_received, v_qty, v_line.qty_ordered;
    end if;
    update public.purchase_lines set qty_received = qty_received + v_qty where id = v_line.id;
    perform public.record_material_movement(v_line.material_id, v_qty, 'purchase_in', null, 'purchase_line', v_line.id, v_loc);
  end loop;

  select bool_and(qty_received >= qty_ordered) into v_all_full from public.purchase_lines where po_id = p_po_id;
  if v_all_full then update public.purchase_orders set status = 'received' where id = p_po_id; end if;
end;
$$;

grant execute on function public.receive_purchase(uuid, jsonb) to authenticated;
