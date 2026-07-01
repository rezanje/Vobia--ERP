create or replace function public.record_movement(
  p_sku_id uuid,
  p_qty integer,
  p_movement_type text,
  p_reason text default null,
  p_ref_type text default null,
  p_ref_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_sku_tenant uuid;
  v_qty integer;
  v_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_qty = 0 then raise exception 'qty must be non-zero'; end if;
  if p_movement_type not in ('production_in','sale_out','return_in','adjustment') then
    raise exception 'invalid movement_type: %', p_movement_type;
  end if;

  select tenant_id into v_sku_tenant from public.skus where id = p_sku_id;
  if v_sku_tenant is null then raise exception 'sku not found'; end if;
  if v_sku_tenant <> v_tenant then raise exception 'sku belongs to another tenant'; end if;

  if p_movement_type = 'adjustment' then
    if p_reason is null or trim(p_reason) = '' then
      raise exception 'adjustment requires a reason';
    end if;
    v_qty := p_qty;
  elsif p_movement_type = 'sale_out' then
    v_qty := -abs(p_qty);
  else
    v_qty := abs(p_qty);
  end if;

  insert into public.stock_ledger (tenant_id, sku_id, qty, movement_type, reason, ref_type, ref_id, created_by)
  values (v_tenant, p_sku_id, v_qty, p_movement_type, p_reason, p_ref_type, p_ref_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_movement(uuid, integer, text, text, text, uuid) to authenticated;
