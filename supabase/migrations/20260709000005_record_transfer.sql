create or replace function public.record_transfer(
  p_sku_id uuid,
  p_qty integer,
  p_from_location uuid,
  p_to_location uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_bal integer;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_qty <= 0 then raise exception 'transfer qty must be positive'; end if;
  if p_from_location = p_to_location then raise exception 'from and to must differ'; end if;

  if not exists (select 1 from public.locations where id = p_from_location and tenant_id = v_tenant) then
    raise exception 'from location not found for tenant';
  end if;
  if not exists (select 1 from public.locations where id = p_to_location and tenant_id = v_tenant) then
    raise exception 'to location not found for tenant';
  end if;
  if not exists (select 1 from public.skus where id = p_sku_id and tenant_id = v_tenant) then
    raise exception 'sku belongs to another tenant';
  end if;

  select coalesce(sum(qty), 0) into v_bal from public.stock_ledger
    where sku_id = p_sku_id and location_id = p_from_location;
  if v_bal < p_qty then
    raise exception 'insufficient balance at source: have %, need %', v_bal, p_qty;
  end if;

  perform public.record_movement(p_sku_id, p_qty, 'transfer_out',
    coalesce(p_reason, 'transfer'), 'transfer', null, p_from_location);
  perform public.record_movement(p_sku_id, p_qty, 'transfer_in',
    coalesce(p_reason, 'transfer'), 'transfer', null, p_to_location);
end;
$$;

grant execute on function
  public.record_transfer(uuid, integer, uuid, uuid, text) to authenticated;
