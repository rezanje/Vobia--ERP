create or replace function public.issue_material_to_po(
  p_prod_po_id uuid,
  p_issues jsonb,
  p_location_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text;
  v_loc uuid;
  v_iss jsonb;
  v_mat uuid;
  v_qty numeric;
  v_bal numeric;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select code into v_code from public.production_orders where id = p_prod_po_id and tenant_id = v_tenant;
  if v_code is null then raise exception 'production order not found'; end if;

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
