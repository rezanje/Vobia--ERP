-- RBAC Penjualan increment: gate order/channel/return writes to owner/sales.
-- READ stays tenant-wide (channels referenced by orders; orders/returns read by
-- finance reports). Fail-closed: missing user_role claim denies.

-- (1) guard the two sales RPCs (create_or_replace preserves existing grants)
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
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_order uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
  v_qty int;
  v_line_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','sales'), true) then
    raise exception 'hanya role Sales/Owner yang boleh membuat order';
  end if;
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

create or replace function public.create_return(
  p_order_id uuid,
  p_return_date date,
  p_reason text,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'RET-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_return uuid;
  v_line jsonb;
  v_sku uuid;
  v_sku_tenant uuid;
  v_qty int;
  v_line_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','sales'), true) then
    raise exception 'hanya role Sales/Owner yang boleh membuat retur';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id and tenant_id = v_tenant) then
    raise exception 'order not in tenant';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then
    raise exception 'at least one line required';
  end if;

  insert into public.returns (tenant_id, code, order_id, return_date, reason, notes)
  values (v_tenant, v_code, p_order_id, coalesce(p_return_date, current_date),
          nullif(trim(p_reason), ''), nullif(trim(p_notes), ''))
  returning id into v_return;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_sku := (v_line ->> 'sku_id')::uuid;
    v_qty := (v_line ->> 'qty')::int;
    select tenant_id into v_sku_tenant from public.skus where id = v_sku;
    if v_sku_tenant is null or v_sku_tenant <> v_tenant then raise exception 'sku not in tenant'; end if;
    if v_qty <= 0 then raise exception 'qty must be > 0'; end if;
    insert into public.return_lines (tenant_id, return_id, sku_id, qty)
    values (v_tenant, v_return, v_sku, v_qty)
    returning id into v_line_id;
    perform public.record_movement(v_sku, v_qty, 'return_in', null, 'return_line', v_line_id);
  end loop;

  return v_return;
end; $$;

-- (2) RESTRICTIVE write-gates -> owner/sales on all five tables
create policy sales_write_insert on public.orders as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.orders as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.orders as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));

create policy sales_write_insert on public.order_lines as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.order_lines as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.order_lines as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));

create policy sales_write_insert on public.returns as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.returns as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.returns as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));

create policy sales_write_insert on public.return_lines as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.return_lines as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.return_lines as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));

create policy sales_write_insert on public.channels as restrictive for insert to authenticated
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_update on public.channels as restrictive for update to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'))
  with check ((auth.jwt() ->> 'user_role') in ('owner','sales'));
create policy sales_write_delete on public.channels as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'user_role') in ('owner','sales'));
