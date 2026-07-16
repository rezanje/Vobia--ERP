-- create_forecast: upsert per (kind, period) — baris lama diganti (alignment bisa iterasi)
create or replace function public.create_forecast(
  p_kind text, p_period text, p_notes text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_id uuid;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_kind not in ('sales','ops') then raise exception 'kind must be sales|ops'; end if;
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
grant execute on function public.create_forecast(text, text, text, jsonb) to authenticated;

-- create_projection: hasil alignment; draft di-replace, locked ditolak (trigger guard)
create or replace function public.create_projection(
  p_period text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_id uuid;
  v_status text;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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
grant execute on function public.create_projection(text, jsonb) to authenticated;

-- lock_projection: draft -> locked (immutable). security definer: trigger guard menolak
-- update biasa; fn ini satu-satunya jalur lock.
create or replace function public.lock_projection(p_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_status text;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  select status into v_status from public.projections where id = p_id and tenant_id = v_tenant for update;
  if v_status is null then raise exception 'projection not found'; end if;
  if v_status = 'locked' then raise exception 'already locked'; end if;
  if not exists (select 1 from public.projection_lines where projection_id = p_id) then
    raise exception 'projection has no lines';
  end if;
  update public.projections set status = 'locked', locked_at = now() where id = p_id;
end;
$$;
grant execute on function public.lock_projection(uuid) to authenticated;
