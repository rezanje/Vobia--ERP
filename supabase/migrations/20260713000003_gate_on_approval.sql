-- Re-declare issue_material_to_po with an approval guard. Body identical to
-- 20260710000006 except the doc_status check after resolving the order.
create or replace function public.issue_material_to_po(
  p_prod_po_id uuid, p_issues jsonb, p_location_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text; v_ds text; v_loc uuid; v_iss jsonb; v_mat uuid; v_qty numeric; v_bal numeric;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select code, doc_status into v_code, v_ds from public.production_orders
    where id = p_prod_po_id and tenant_id = v_tenant;
  if v_code is null then raise exception 'production order not found'; end if;
  if v_ds <> 'approved' then raise exception 'production order belum di-ACC'; end if;

  if p_location_id is null then
    select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
    if v_loc is null then raise exception 'no default location'; end if;
  else
    if not exists (select 1 from public.locations where id = p_location_id and tenant_id = v_tenant) then
      raise exception 'location not in tenant';
    end if;
    v_loc := p_location_id;
  end if;
  if p_issues is null or jsonb_array_length(p_issues) < 1 then raise exception 'no issues'; end if;

  for v_iss in select value from jsonb_array_elements(p_issues) loop
    v_mat := (v_iss ->> 'material_id')::uuid;
    v_qty := (v_iss ->> 'qty')::numeric;
    if v_qty <= 0 then raise exception 'issue qty must be > 0'; end if;
    if not exists (select 1 from public.materials where id = v_mat and tenant_id = v_tenant) then
      raise exception 'material not in tenant';
    end if;
    select coalesce(sum(qty), 0) into v_bal from public.material_ledger
      where material_id = v_mat and location_id = v_loc;
    if v_bal < v_qty then raise exception 'insufficient material balance: have %, need %', v_bal, v_qty; end if;
    perform public.record_material_movement(v_mat, v_qty, 'issue_out', 'issue to ' || v_code, 'production_order', p_prod_po_id, v_loc);
  end loop;
end;
$$;
grant execute on function public.issue_material_to_po(uuid, jsonb, uuid) to authenticated;

-- Re-declare receive_purchase with an approval guard. Body identical to
-- 20260710000004 except doc_status is fetched and checked.
create or replace function public.receive_purchase(p_po_id uuid, p_receipts jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_status text; v_ds text; v_loc uuid; v_rec jsonb; v_line public.purchase_lines; v_qty numeric; v_all_full boolean;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select status, doc_status, location_id into v_status, v_ds, v_loc from public.purchase_orders
    where id = p_po_id and tenant_id = v_tenant;
  if v_status is null then raise exception 'purchase order not found'; end if;
  if v_ds <> 'approved' then raise exception 'purchase order belum di-ACC'; end if;
  if v_status = 'canceled' then raise exception 'cannot receive a canceled PO'; end if;
  if p_receipts is null or jsonb_array_length(p_receipts) < 1 then raise exception 'no receipts'; end if;

  for v_rec in select value from jsonb_array_elements(p_receipts) loop
    v_qty := (v_rec ->> 'qty')::numeric;
    if v_qty <= 0 then raise exception 'receipt qty must be > 0'; end if;
    select * into v_line from public.purchase_lines
      where id = (v_rec ->> 'line_id')::uuid and po_id = p_po_id and tenant_id = v_tenant for update;
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
