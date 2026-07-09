-- Drop the pre-location 6-arg overload so callers can't bind the old signature.
drop function if exists public.record_movement(uuid, integer, text, text, text, uuid);

create or replace function public.record_movement(
  p_sku_id uuid,
  p_qty integer,
  p_movement_type text,
  p_reason text default null,
  p_ref_type text default null,
  p_ref_id uuid default null,
  p_location_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_sku_tenant uuid;
  v_loc_tenant uuid;
  v_location uuid;
  v_qty integer;
  v_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_qty = 0 then raise exception 'qty must be non-zero'; end if;
  if p_movement_type not in
     ('production_in','sale_out','return_in','adjustment','transfer_in','transfer_out') then
    raise exception 'invalid movement_type: %', p_movement_type;
  end if;

  select tenant_id into v_sku_tenant from public.skus where id = p_sku_id;
  if v_sku_tenant is null then raise exception 'sku not found'; end if;
  if v_sku_tenant <> v_tenant then raise exception 'sku belongs to another tenant'; end if;

  -- resolve location: explicit (validated) or tenant default
  if p_location_id is null then
    select id into v_location from public.locations
      where tenant_id = v_tenant and is_default limit 1;
    if v_location is null then raise exception 'no default location for tenant'; end if;
  else
    select tenant_id into v_loc_tenant from public.locations where id = p_location_id;
    if v_loc_tenant is null then raise exception 'location not found'; end if;
    if v_loc_tenant <> v_tenant then raise exception 'location belongs to another tenant'; end if;
    v_location := p_location_id;
  end if;

  if p_movement_type = 'adjustment' then
    if p_reason is null or trim(p_reason) = '' then
      raise exception 'adjustment requires a reason';
    end if;
    v_qty := p_qty;
  elsif p_movement_type in ('sale_out','transfer_out') then
    v_qty := -abs(p_qty);
  else
    v_qty := abs(p_qty);  -- production_in, return_in, transfer_in
  end if;

  insert into public.stock_ledger
    (tenant_id, sku_id, location_id, qty, movement_type, reason, ref_type, ref_id, created_by)
  values
    (v_tenant, p_sku_id, v_location, v_qty, p_movement_type, p_reason, p_ref_type, p_ref_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function
  public.record_movement(uuid, integer, text, text, text, uuid, uuid) to authenticated;
