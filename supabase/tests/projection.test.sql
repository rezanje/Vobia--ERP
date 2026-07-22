set search_path to public, auth;
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values ('b8888888-8888-8888-8888-888888888888','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','proj@s.test','{"tenant_name":"Proj Co"}');

do $$
declare
  v_user uuid := 'b8888888-8888-8888-8888-888888888888';
  v_tenant uuid := (select tenant_id from public.profiles where id='b8888888-8888-8888-8888-888888888888');
  v_style uuid; v_cw uuid; v_sku uuid; v_vendor uuid; v_po uuid;
  r record;
  v_n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_user,'role','authenticated','tenant_id',v_tenant::text,'user_role','owner')::text, true);
  perform set_config('role','authenticated', true);

  insert into public.styles (tenant_id, code, name) values (v_tenant,'PRJ-01','Proj Style') returning id into v_style;
  insert into public.colorways (tenant_id, style_id, color_name, color_code)
    values (v_tenant, v_style, 'Black', 'BLK') returning id into v_cw;
  insert into public.skus (tenant_id, colorway_id, size, sku_code, cogs, retail_price)
    values (v_tenant, v_cw, 'M', 'PRJ-01-BLK-M', 10000, 50000) returning id into v_sku;

  -- posisi awal 500 pcs dari ledger (bukan angka ketikan)
  perform public.record_movement(v_sku, 500, 'production_in');

  -- ---------------------------------------------------------------------
  -- KASUS 1: stok berlebih -> tidak ada order sama sekali
  -- carry 500, sales 100, cover 1.5 -> butuh 150, sudah punya 500 -> incoming 0
  -- ---------------------------------------------------------------------
  perform public.set_demand_plan(jsonb_build_array(
    jsonb_build_object('sku_id', v_sku, 'month', '2026-08-01', 'qty', 100),
    jsonb_build_object('sku_id', v_sku, 'month', '2026-09-01', 'qty', 100),
    jsonb_build_object('sku_id', v_sku, 'month', '2026-10-01', 'qty', 100)));

  select * into r from public.project_stock('2026-08-01', 3) where month = '2026-08-01';
  if r.incoming_qty <> 0    then raise exception 'K1 Agu incoming expected 0 got %', r.incoming_qty; end if;
  if r.beginning_qty <> 500 then raise exception 'K1 Agu beginning expected 500 got %', r.beginning_qty; end if;
  if r.ending_qty <> 400    then raise exception 'K1 Agu ending expected 400 got %', r.ending_qty; end if;

  select * into r from public.project_stock('2026-08-01', 3) where month = '2026-10-01';
  if r.beginning_qty <> 300 then raise exception 'K1 Okt beginning expected 300 got %', r.beginning_qty; end if;
  if r.ending_qty <> 200    then raise exception 'K1 Okt ending expected 200 got %', r.ending_qty; end if;

  -- ---------------------------------------------------------------------
  -- KASUS 2: butuh restock -> aturan cover 1.5x, lalu steady state
  -- carry 500, sales 1000 -> butuh 1500, order 1000, ending 500
  -- bulan berikut sales 1000, carry 500 -> order 1000 lagi, ending 500 (stabil)
  -- ---------------------------------------------------------------------
  perform public.set_demand_plan(jsonb_build_array(
    jsonb_build_object('sku_id', v_sku, 'month', '2026-08-01', 'qty', 1000),
    jsonb_build_object('sku_id', v_sku, 'month', '2026-09-01', 'qty', 1000)));

  select * into r from public.project_stock('2026-08-01', 3) where month = '2026-08-01';
  if r.incoming_qty <> 1000  then raise exception 'K2 Agu incoming expected 1000 got %', r.incoming_qty; end if;
  if r.beginning_qty <> 1500 then raise exception 'K2 Agu beginning expected 1500 got %', r.beginning_qty; end if;
  if r.ending_qty <> 500     then raise exception 'K2 Agu ending expected 500 got %', r.ending_qty; end if;
  if r.cover_ratio <> 1.50   then raise exception 'K2 Agu cover_ratio expected 1.50 got %', r.cover_ratio; end if;

  -- nilai rupiah: qty x harga master, net = gross x 95%
  if r.sales_gross <> 1000 * 50000        then raise exception 'K2 sales_gross salah: %', r.sales_gross; end if;
  if r.sales_cogs  <> 1000 * 10000        then raise exception 'K2 sales_cogs salah: %', r.sales_cogs; end if;
  if r.sales_net   <> 1000 * 50000 * 0.95 then raise exception 'K2 sales_net salah: %', r.sales_net; end if;

  select * into r from public.project_stock('2026-08-01', 3) where month = '2026-09-01';
  if r.incoming_qty <> 1000 then raise exception 'K2 Sep incoming expected 1000 got %', r.incoming_qty; end if;
  if r.ending_qty <> 500    then raise exception 'K2 Sep ending expected 500 got %', r.ending_qty; end if;

  -- ---------------------------------------------------------------------
  -- KASUS 3: bulan tanpa forecast -> tidak order, stok hanya diteruskan
  -- Oktober qty 100 diganti 0
  -- ---------------------------------------------------------------------
  perform public.set_demand_plan(jsonb_build_array(
    jsonb_build_object('sku_id', v_sku, 'month', '2026-10-01', 'qty', 0)));
  select * into r from public.project_stock('2026-08-01', 3) where month = '2026-10-01';
  if r.incoming_qty <> 0 then raise exception 'K3 Okt incoming expected 0 got %', r.incoming_qty; end if;
  if r.beginning_qty <> r.ending_qty then raise exception 'K3 Okt stok harus diteruskan utuh'; end if;
  if r.cover_ratio is not null then raise exception 'K3 cover_ratio harus null saat sales 0'; end if;

  -- ---------------------------------------------------------------------
  -- KASUS 4: asumsi bisa diubah -> cover 2.0 menaikkan order
  -- sales 1000, carry 500 -> butuh 2000, order 1500
  -- ---------------------------------------------------------------------
  perform public.set_planning_params(2.0, 27, 0.95, 2);
  select * into r from public.project_stock('2026-08-01', 1) where month = '2026-08-01';
  if r.incoming_qty <> 1500 then raise exception 'K4 cover 2.0 incoming expected 1500 got %', r.incoming_qty; end if;
  perform public.set_planning_params(1.5, 27, 0.95, 2);

  -- ---------------------------------------------------------------------
  -- KASUS 4b: lead time -> kapan barang harus mulai dipesan
  -- lead 2 bulan: kedatangan Oktober harus dipesan Agustus
  -- ---------------------------------------------------------------------
  select * into r from public.project_stock('2026-08-01', 3) where month = '2026-10-01';
  if r.order_month <> date '2026-08-01' then
    raise exception 'K4b order_month expected 2026-08-01 got %', r.order_month;
  end if;

  -- lead 0 -> pesan di bulan kedatangan itu sendiri
  perform public.set_planning_params(1.5, 27, 0.95, 0);
  select * into r from public.project_stock('2026-08-01', 3) where month = '2026-10-01';
  if r.order_month <> date '2026-10-01' then
    raise exception 'K4b lead 0: order_month expected 2026-10-01 got %', r.order_month;
  end if;

  -- lead time hanya menggeser "kapan pesan", tidak mengubah roll stoknya.
  -- Oktober dari KASUS 3: sales 0, tidak ada order, stok diteruskan utuh.
  if r.incoming_qty <> 0 or r.beginning_qty <> r.ending_qty then
    raise exception 'K4b lead time mengubah roll stok: masuk=% awal=% akhir=%',
      r.incoming_qty, r.beginning_qty, r.ending_qty;
  end if;
  perform public.set_planning_params(1.5, 27, 0.95, 2);

  -- ---------------------------------------------------------------------
  -- KASUS 4c: order berjalan dipotong dari usulan (anti double-order)
  -- Agu: carry 500, sales 1000, butuh 1500 -> tanpa PO usulannya 1000.
  -- Setelah PO 400 pcs jatuh tempo Agustus, usulan tinggal 600,
  -- tapi total kedatangan tetap 1000 dan stok akhir tetap 500.
  -- ---------------------------------------------------------------------
  select * into r from public.project_stock('2026-08-01', 1) where month = '2026-08-01';
  if r.suggested_qty <> 1000 then raise exception 'K4c awal: usulan expected 1000 got %', r.suggested_qty; end if;
  if r.committed_qty <> 0 then raise exception 'K4c awal: committed expected 0 got %', r.committed_qty; end if;

  insert into public.vendors (tenant_id, name) values (v_tenant, 'Vendor Proyeksi') returning id into v_vendor;
  v_po := public.create_production_order(v_style, v_vendor, date '2026-08-20', 'dari proyeksi',
            jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'qty_ordered', 400)));

  select * into r from public.project_stock('2026-08-01', 1) where month = '2026-08-01';
  if r.committed_qty <> 400 then raise exception 'K4c: committed expected 400 got %', r.committed_qty; end if;
  if r.suggested_qty <> 600 then raise exception 'K4c: usulan expected 600 got %', r.suggested_qty; end if;
  if r.incoming_qty <> 1000 then raise exception 'K4c: total masuk expected 1000 got %', r.incoming_qty; end if;
  if r.beginning_qty <> 1500 then raise exception 'K4c: stok awal expected 1500 got %', r.beginning_qty; end if;
  if r.ending_qty <> 500 then raise exception 'K4c: stok akhir expected 500 got %', r.ending_qty; end if;

  -- PO selesai -> tidak lagi dihitung sebagai barang jalan (stoknya masuk lewat ledger)
  update public.production_orders set stage = 'completed' where id = v_po;
  select * into r from public.project_stock('2026-08-01', 1) where month = '2026-08-01';
  if r.committed_qty <> 0 then raise exception 'K4c selesai: committed expected 0 got %', r.committed_qty; end if;
  if r.suggested_qty <> 1000 then raise exception 'K4c selesai: usulan expected 1000 got %', r.suggested_qty; end if;
  update public.production_orders set stage = 'canceled' where id = v_po;

  -- ---------------------------------------------------------------------
  -- KASUS 5: summary per bulan
  -- GPM = (net - cogs) / gross = (47.5jt - 10jt) / 50jt = 0.75
  -- ---------------------------------------------------------------------
  select * into r from public.projection_summary('2026-08-01', 1) where month = '2026-08-01';
  if r.gpm <> 0.7500 then raise exception 'K5 gpm expected 0.75 got %', r.gpm; end if;
  if r.stock_ratio <> 1.50 then raise exception 'K5 stock_ratio expected 1.50 got %', r.stock_ratio; end if;

  -- ---------------------------------------------------------------------
  -- KASUS 6: seed run-rate tidak menimpa angka yang sudah disentuh manusia
  -- ---------------------------------------------------------------------
  perform public.record_movement(v_sku, 90, 'sale_out');
  v_n := public.seed_demand_plan('2026-08-01', 3, 90);
  select qty into v_n from public.demand_plan where sku_id = v_sku and month = '2026-08-01';
  if v_n <> 1000 then raise exception 'K6 baris manual tertimpa seed: %', v_n; end if;

  -- baris baru (bulan di luar yang pernah diisi manual) memang terisi run-rate
  select qty into v_n from public.demand_plan where sku_id = v_sku and month = '2026-11-01';
  if v_n is not null then raise exception 'K6 Nov seharusnya di luar rentang seed'; end if;

  -- ---------------------------------------------------------------------
  -- KASUS 7: guard role
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_user,'role','authenticated','tenant_id',v_tenant::text,'user_role','sales')::text, true);
  begin
    perform public.set_planning_params(3.0, 27, 0.95);
    raise exception 'FAIL: sales boleh ubah asumsi perencanaan';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub',v_user,'role','authenticated','tenant_id',v_tenant::text,'user_role','ops')::text, true);
  begin
    perform public.set_demand_plan(jsonb_build_array(
      jsonb_build_object('sku_id', v_sku, 'month', '2026-08-01', 'qty', 1)));
    raise exception 'FAIL: ops boleh input forecast penjualan';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- tulis langsung ke tabel harus ditolak (fn adalah satu-satunya jalur tulis)
  begin
    insert into public.demand_plan (tenant_id, sku_id, month, qty)
      values (v_tenant, v_sku, '2026-08-01', 5);
    raise exception 'FAIL: insert langsung ke demand_plan lolos';
  exception
    when insufficient_privilege then null;
    when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  reset role;
  raise notice 'projection OK: overstock=no order, restock=cover 1.5x, steady state, sales 0, cover configurable, summary GPM, seed tidak timpa manual, role guards';
end $$;

rollback;
