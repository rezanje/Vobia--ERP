-- Role guards for Sales-vs-Ops demo: each fn is the sole write path into its
-- table(s), so the check lives here rather than as blanket table RLS (which
-- would also need to special-case the legacy purchase_orders/purchase_lines
-- writers). lock_projection is `security definer` — RLS never applies to it,
-- so its guard is the only thing stopping a direct RPC call from a sales role.

create or replace function public.create_forecast(
  p_kind text, p_period text, p_notes text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_id uuid;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_kind not in ('sales','ops') then raise exception 'kind must be sales|ops'; end if;
  if p_kind = 'sales' and coalesce(v_role not in ('owner','sales'), true) then
    raise exception 'hanya role Sales/Owner yang boleh input forecast Sales';
  end if;
  if p_kind = 'ops' and coalesce(v_role not in ('owner','ops'), true) then
    raise exception 'hanya role Ops/Owner yang boleh input forecast Operasional';
  end if;
  if p_period !~ '^\d{4}-Q[1-4]$' then raise exception 'period must be YYYY-Qn'; end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then raise exception 'at least one line required'; end if;

  select id into v_id from public.forecasts where tenant_id = v_tenant and kind = p_kind and period = p_period;
  if v_id is null then
    insert into public.forecasts (tenant_id, kind, period, notes)
    values (v_tenant, p_kind, p_period, nullif(trim(p_notes), '')) returning id into v_id;
  else
    update public.forecasts set notes = nullif(trim(p_notes), '') where id = v_id;
    delete from public.forecast_lines where forecast_id = v_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.styles where id = (v_line ->> 'style_id')::uuid and tenant_id = v_tenant) then
      raise exception 'style not in tenant';
    end if;
    insert into public.forecast_lines (tenant_id, forecast_id, style_id, qty, ito, stock_ratio)
    values (v_tenant, v_id, (v_line ->> 'style_id')::uuid, (v_line ->> 'qty')::int,
            (v_line ->> 'ito')::numeric, (v_line ->> 'stock_ratio')::numeric);
  end loop;
  return v_id;
end;
$$;

create or replace function public.create_projection(
  p_period text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_id uuid;
  v_status text;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','ops'), true) then raise exception 'hanya role Ops/Owner yang boleh membuat proyeksi'; end if;
  if p_period !~ '^\d{4}-Q[1-4]$' then raise exception 'period must be YYYY-Qn'; end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then raise exception 'at least one line required'; end if;

  select id, status into v_id, v_status from public.projections where tenant_id = v_tenant and period = p_period;
  if v_status = 'locked' then raise exception 'projection % already locked', p_period; end if;
  if v_id is null then
    insert into public.projections (tenant_id, period) values (v_tenant, p_period) returning id into v_id;
  else
    delete from public.projection_lines where projection_id = v_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.styles where id = (v_line ->> 'style_id')::uuid and tenant_id = v_tenant) then
      raise exception 'style not in tenant';
    end if;
    insert into public.projection_lines (tenant_id, projection_id, style_id, qty, kind, new_product_id)
    values (v_tenant, v_id, (v_line ->> 'style_id')::uuid, (v_line ->> 'qty')::int,
            coalesce(v_line ->> 'kind', 'regular'), (v_line ->> 'new_product_id')::uuid);
  end loop;
  return v_id;
end;
$$;

create or replace function public.lock_projection(p_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_status text;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','ops'), true) then raise exception 'hanya role Ops/Owner yang boleh mengunci proyeksi'; end if;
  select status into v_status from public.projections where id = p_id and tenant_id = v_tenant for update;
  if v_status is null then raise exception 'projection not found'; end if;
  if v_status = 'locked' then raise exception 'already locked'; end if;
  if not exists (select 1 from public.projection_lines where projection_id = p_id) then
    raise exception 'projection has no lines';
  end if;
  update public.projections set status = 'locked', locked_at = now() where id = p_id;
end;
$$;

create or replace function public.create_pcb(
  p_projection_id uuid, p_quarter text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'PCB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_id uuid;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','ops'), true) then raise exception 'hanya role Ops/Owner yang boleh membuat PCB'; end if;
  if p_quarter !~ '^\d{4}-Q[1-4]$' then raise exception 'quarter must be YYYY-Qn'; end if;
  if not exists (select 1 from public.projections
                  where id = p_projection_id and tenant_id = v_tenant and status = 'locked') then
    raise exception 'projection not found or not locked';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 1 then raise exception 'at least one line required'; end if;

  insert into public.pcb (tenant_id, code, quarter, projection_id)
  values (v_tenant, v_code, p_quarter, p_projection_id) returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.styles where id = (v_line ->> 'style_id')::uuid and tenant_id = v_tenant) then
      raise exception 'style not in tenant';
    end if;
    insert into public.pcb_lines (tenant_id, pcb_id, style_id, target_sales, ending_stock, unit_cost)
    values (v_tenant, v_id, (v_line ->> 'style_id')::uuid,
            (v_line ->> 'target_sales')::int,
            coalesce((v_line ->> 'ending_stock')::int, 0),
            coalesce((v_line ->> 'unit_cost')::numeric, 0));
  end loop;
  return v_id;
end;
$$;

create or replace function public.create_ppo(
  p_pcb_id uuid, p_style_id uuid, p_scheme text, p_qty int, p_notes text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_code text := 'PPO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','ops'), true) then raise exception 'hanya role Ops/Owner yang boleh membuat PPO'; end if;
  if p_scheme not in ('fob','cmt') then raise exception 'scheme must be fob|cmt'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be > 0'; end if;
  if not exists (select 1 from public.pcb where id = p_pcb_id and tenant_id = v_tenant) then
    raise exception 'pcb not found';
  end if;
  if not exists (select 1 from public.pcb_lines where pcb_id = p_pcb_id and style_id = p_style_id) then
    raise exception 'style not in this pcb';
  end if;
  insert into public.ppo (tenant_id, code, pcb_id, style_id, scheme, qty, notes)
  values (v_tenant, v_code, p_pcb_id, p_style_id, p_scheme, p_qty, nullif(trim(p_notes), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.issue_ppo_pos(
  p_ppo_id uuid, p_children jsonb
) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role text := auth.jwt() ->> 'user_role';
  v_ppo public.ppo;
  v_loc uuid;
  v_child jsonb;
  v_i int := 0;
  v_type text;
  v_vendor uuid;
  v_po uuid;
  v_n int;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if coalesce(v_role not in ('owner','ops'), true) then raise exception 'hanya role Ops/Owner yang boleh menerbitkan PO dari PPO'; end if;
  select * into v_ppo from public.ppo where id = p_ppo_id and tenant_id = v_tenant for update;
  if v_ppo.id is null then raise exception 'ppo not found'; end if;
  if v_ppo.status <> 'draft' then raise exception 'ppo already issued'; end if;
  if p_children is null or jsonb_array_length(p_children) < 1 then raise exception 'at least one child PO required'; end if;
  v_n := jsonb_array_length(p_children);
  if v_ppo.scheme = 'fob' and v_n <> 1 then raise exception 'FOB: exactly 1 child PO'; end if;

  select id into v_loc from public.locations where tenant_id = v_tenant and is_default limit 1;
  if v_loc is null then raise exception 'no default location'; end if;

  for v_child in select value from jsonb_array_elements(p_children) loop
    v_i := v_i + 1;
    v_type := v_child ->> 'po_type';
    v_vendor := (v_child ->> 'vendor_id')::uuid;
    if v_type is null then raise exception 'po_type required on each child'; end if;
    if v_ppo.scheme = 'fob' and v_type <> 'finished' then
      raise exception 'FOB child must be finished';
    end if;
    if v_ppo.scheme = 'cmt' and v_type not in ('material','sewing','bordir','accessory') then
      raise exception 'CMT child must be material|sewing|bordir|accessory';
    end if;
    if not exists (select 1 from public.vendors where id = v_vendor and tenant_id = v_tenant) then
      raise exception 'vendor not in tenant';
    end if;

    insert into public.purchase_orders (tenant_id, code, vendor_id, location_id, notes, ppo_id, po_type, amount)
    values (v_tenant, v_ppo.code || '-' || chr(64 + v_i), v_vendor, v_loc,
            nullif(trim(coalesce(v_child ->> 'notes', '')), ''),
            p_ppo_id, v_type, coalesce((v_child ->> 'amount')::numeric, 0))
    returning id into v_po;

    if v_type = 'material' and (v_child ->> 'material_id') is not null then
      if not exists (select 1 from public.materials where id = (v_child ->> 'material_id')::uuid and tenant_id = v_tenant) then
        raise exception 'material not in tenant';
      end if;
      insert into public.purchase_lines (tenant_id, po_id, material_id, qty_ordered, unit_price)
      values (v_tenant, v_po, (v_child ->> 'material_id')::uuid,
              (v_child ->> 'qty')::numeric, coalesce((v_child ->> 'unit_price')::numeric, 0));
    end if;
  end loop;

  update public.ppo set status = 'issued' where id = p_ppo_id;
end;
$$;
