create or replace function public.approve_document(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := (auth.jwt() ->> 'tenant_id')::uuid;
  v_role   text := auth.jwt() ->> 'user_role';
  v_hit    uuid;
begin
  if v_tenant is null then raise exception 'no tenant_id in JWT'; end if;
  if p_kind not in ('production','purchase') then raise exception 'invalid kind: %', p_kind; end if;
  if coalesce(v_role,'') not in ('owner','ops') then raise exception 'not authorized to approve'; end if;

  if p_kind = 'production' then
    update public.production_orders
      set doc_status='approved', approved_by=auth.uid(), approved_at=now()
      where id=p_id and tenant_id=v_tenant and doc_status='draft'
      returning id into v_hit;
    if v_hit is null and not exists
       (select 1 from public.production_orders where id=p_id and tenant_id=v_tenant) then
      raise exception 'production order not found';
    end if;  -- v_hit null + row exists = already approved -> idempotent no-op
  else
    update public.purchase_orders
      set doc_status='approved', approved_by=auth.uid(), approved_at=now()
      where id=p_id and tenant_id=v_tenant and doc_status='draft'
      returning id into v_hit;
    if v_hit is null and not exists
       (select 1 from public.purchase_orders where id=p_id and tenant_id=v_tenant) then
      raise exception 'purchase order not found';
    end if;
  end if;
end;
$$;

grant execute on function public.approve_document(text, uuid) to authenticated;
