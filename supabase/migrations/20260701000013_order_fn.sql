create or replace function public.create_order(
  p_channel_id uuid,
  p_order_date date,
  p_customer text,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text := 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_order uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
  v_qty int;
  v_line_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if not exists (select 1 from public.channels where id = p_channel_id and tenant_id = v_tenant) then
    raise exception 'channel not in tenant';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then
    raise exception 'at least one line required';
  end if;

  insert into public.orders (tenant_id, code, channel_id, order_date, customer, notes)
  values (v_tenant, v_code, p_channel_id, coalesce(p_order_date, current_date),
          nullif(trim(p_customer), ''), nullif(trim(p_notes), ''))
  returning id into v_order;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_sku := (v_line ->> 'sku_id')::uuid;
    v_qty := (v_line ->> 'qty')::int;
    select tenant_id into v_sku_tenant from public.skus where id = v_sku;
    if v_sku_tenant is null or v_sku_tenant <> v_tenant then raise exception 'sku not in tenant'; end if;
    if v_qty <= 0 then raise exception 'qty must be > 0'; end if;
    insert into public.order_lines (tenant_id, order_id, sku_id, qty, unit_price)
    values (v_tenant, v_order, v_sku, v_qty, coalesce((v_line ->> 'unit_price')::numeric, 0))
    returning id into v_line_id;
    perform public.record_movement(v_sku, v_qty, 'sale_out', null, 'order_line', v_line_id);
  end loop;

  return v_order;
end; $$;

grant execute on function public.create_order(uuid, date, text, text, jsonb) to authenticated;
