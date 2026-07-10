set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('f1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','bom@s.test','{"tenant_name":"Bom Co"}');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('f2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','bom2@s.test','{"tenant_name":"Bom Other"}');

do $$
declare
  v_tenant uuid := (select tenant_id from public.profiles where id='f1111111-1111-1111-1111-111111111111');
  v_other  uuid := (select tenant_id from public.profiles where id='f2222222-2222-2222-2222-222222222222');
  v_style uuid; v_mat uuid;
begin
  -- foreign BOM row for RLS
  insert into public.styles (tenant_id, code, name) values (v_other, 'OTHS', 'Oth') returning id into v_style;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_other,'OM','Oth','fabric','m') returning id into v_mat;
  insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit) values (v_other, v_style, v_mat, 1.5);

  perform set_config('request.jwt.claims',
    json_build_object('sub','f1111111-1111-1111-1111-111111111111','role','authenticated','tenant_id',v_tenant::text)::text, true);
  perform set_config('role','authenticated', true);

  insert into public.styles (tenant_id, code, name) values (v_tenant, 'MYS', 'My') returning id into v_style;
  insert into public.materials (tenant_id, code, name, category, uom) values (v_tenant,'MM','Mine','fabric','m') returning id into v_mat;
  insert into public.bom_lines (tenant_id, style_id, material_id, qty_per_unit) values (v_tenant, v_style, v_mat, 1.25);

  -- RLS: foreign BOM invisible
  if exists (select 1 from public.bom_lines where tenant_id = v_other) then raise exception 'RLS leak on bom_lines'; end if;
  reset role;
  raise notice 'bom_lines OK: insert + RLS';
end $$;

rollback;
