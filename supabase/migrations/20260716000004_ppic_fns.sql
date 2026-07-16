-- create_pcb: dari projection yang sudah locked. Lines dikirim dari UI
-- (prefill target dari projection + ending stock dari stock_balances, editable).
create or replace function public.create_pcb(
  p_projection_id uuid, p_quarter text, p_lines jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text := 'PCB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_id uuid;
  v_line jsonb;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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
grant execute on function public.create_pcb(uuid, text, jsonb) to authenticated;

-- create_ppo: PPO induk per style dari PCB, pilih scheme fob|cmt
create or replace function public.create_ppo(
  p_pcb_id uuid, p_style_id uuid, p_scheme text, p_qty int, p_notes text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_code text := 'PPO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_id uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
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
grant execute on function public.create_ppo(uuid, uuid, text, int, text) to authenticated;
