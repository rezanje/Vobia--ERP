-- issue_ppo_pos: pecah PPO jadi PO anak.
-- FOB  -> tepat 1 anak, po_type='finished'.
-- CMT  -> >=1 anak, po_type in (material|sewing|bordir|accessory); anak material boleh
--         bawa 1 baris bahan (material_id/qty/unit_price) supaya receive existing jalan.
-- Kode anak: <kode PPO>-A, -B, -C... (SOP: PO 1A/1B/1C/1D).
create or replace function public.issue_ppo_pos(
  p_ppo_id uuid, p_children jsonb
) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
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
grant execute on function public.issue_ppo_pos(uuid, jsonb) to authenticated;
