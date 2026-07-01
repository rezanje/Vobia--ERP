set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('d4444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','cs@c.test','{"tenant_name":"CS Co"}');

select set_config('request.jwt.claims',
  json_build_object('sub','d4444444-4444-4444-4444-444444444444','role','authenticated',
    'tenant_id',(select tenant_id::text from public.profiles where id='d4444444-4444-4444-4444-444444444444'))::text, true);
set local role authenticated;

do $$
declare
  v_style uuid;
  v_skus int;
  v_override text;
  my_tenant uuid := (current_setting('request.jwt.claims')::json->>'tenant_id')::uuid;
begin
  v_style := public.create_style_with_skus(
    'VB-MIRA','Mira Pleated Top','Daily Muse',
    '[{"color_name":"Black","color_code":"BLK"},{"color_name":"Cream","color_code":"CRM"}]'::jsonb,
    array['S','M','L'],
    '{"BLK-S":"CUSTOM-BLK-S"}'::jsonb
  );

  select count(*) into v_skus from public.skus k
    join public.colorways c on c.id = k.colorway_id
    where c.style_id = v_style and k.tenant_id = my_tenant;
  if v_skus <> 6 then raise exception 'expected 6 skus, got %', v_skus; end if;

  if not exists (select 1 from public.skus where sku_code = 'VB-MIRA-CRM-M') then
    raise exception 'auto sku_code VB-MIRA-CRM-M missing';
  end if;

  select sku_code into v_override from public.skus where sku_code = 'CUSTOM-BLK-S';
  if v_override is null then raise exception 'override CUSTOM-BLK-S not applied'; end if;

  raise notice 'create_style OK: 6 skus, auto + override correct';
end $$;

do $$
declare before_ct int; after_ct int;
begin
  select count(*) into before_ct from public.styles;
  begin
    perform public.create_style_with_skus(
      'DUP','Dup','', '[{"color_name":"X","color_code":"X"}]'::jsonb,
      array['S','S'], '{}'::jsonb);
    raise exception 'expected unique violation, none raised';
  exception when unique_violation then
    null;
  end;
  select count(*) into after_ct from public.styles;
  if after_ct <> before_ct then raise exception 'partial style left after rollback'; end if;
  raise notice 'rollback OK: no orphan style on failure';
end $$;

rollback;
