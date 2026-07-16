// Demo data seeder for a tenant, keyed by its owner's login email.
// Idempotent: wipes this tenant's domain data, then rebuilds one coherent
// fashion-brand dataset that exercises every module — materials, purchasing,
// BOM, material issue, production, finished-goods stock, sales, returns,
// multi-location transfer, and production costing (HPP).
//
//   node scripts/seed-demo.mjs [email]      # defaults to demo.vobia@gmail.com
//
// Runs as the postgres role over the pooler (SUPABASE_DB_URL in .env.local),
// so it bypasses RLS and the append-only ledger grants and writes ledgers
// directly, mirroring the sign convention of record_movement().
// ponytail: direct ledger inserts instead of the RPCs — RPCs need auth.jwt();
// seeding runs as postgres. Signs kept in lockstep with the SQL functions.

import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const DB = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
if (!DB) throw new Error('SUPABASE_DB_URL not found in .env.local');

const DEMO_EMAIL = process.argv[2] || 'demo.vobia@gmail.com';
const c = new Client({ connectionString: DB });

// today + N days, as YYYY-MM-DD
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

await c.connect();
try {
  await c.query('begin');

  const { rows: [who] } = await c.query(
    `select p.tenant_id, p.id as uid
       from profiles p join auth.users u on u.id = p.id
      where u.email = $1`, [DEMO_EMAIL]);
  if (!who) throw new Error(`demo user ${DEMO_EMAIL} not found — sign up first`);
  const T = who.tenant_id, UID = who.uid;
  console.log('tenant', T);

  // --- wipe this tenant's domain data (FK-safe order) ---------------------
  // projections may be left 'locked' by a prior run of this seeder, which
  // trips the lock-guard triggers on delete -> disable both around the wipe.
  await c.query(`alter table projection_lines disable trigger projection_lines_lock_guard`);
  await c.query(`alter table projections disable trigger projections_lock_guard`);
  for (const t of [
    'return_lines', 'returns', 'order_lines', 'orders',
    'cost_entries', 'prod_lines', 'production_orders',
    'po_payments', 'purchase_lines', 'purchase_orders',
    'ppo', 'pcb_lines', 'pcb',
    'projection_lines', 'projections', 'new_products',
    'forecast_lines', 'forecasts',
    'bom_lines', 'material_ledger', 'stock_ledger',
    'skus', 'colorways', 'styles', 'materials', 'channels', 'vendors',
  ]) await c.query(`delete from ${t} where tenant_id = $1`, [T]);
  await c.query(`alter table projections enable trigger projections_lock_guard`);
  await c.query(`alter table projection_lines enable trigger projection_lines_lock_guard`);
  // keep the default location; drop any extras so re-runs stay clean
  await c.query('delete from locations where tenant_id=$1 and not is_default', [T]);

  const ins = async (sql, vals) => (await c.query(sql, vals)).rows[0].id;

  // --- locations ----------------------------------------------------------
  const { rows: [gudang] } = await c.query(
    'select id from locations where tenant_id=$1 and is_default', [T]);
  const LOC_MAIN = gudang.id;
  const LOC_TOKO = await ins(
    `insert into locations(tenant_id,name,is_default) values($1,'Toko Jakarta',false) returning id`, [T]);

  // --- vendors ------------------------------------------------------------
  const V = {};
  for (const [k, name, contact] of [
    ['kain', 'PT Kain Nusantara', 'Pak Budi 0812-1111-2222'],
    ['cmt', 'CV Jahit Makmur', 'Bu Yanti 0813-3333-4444'],
    ['aks', 'Aksesoris Jaya', 'Pak Deni 0857-5555-6666'],
  ]) V[k] = await ins(
    `insert into vendors(tenant_id,name,contact) values($1,$2,$3) returning id`, [T, name, contact]);

  // --- materials ----------------------------------------------------------
  const M = {};
  for (const [k, code, name, cat, uom] of [
    ['cotton', 'FAB-COTTON', 'Katun Combed 30s', 'fabric', 'meter'],
    ['rayon', 'FAB-RAYON', 'Rayon Twill', 'fabric', 'meter'],
    ['btn', 'TRIM-BTN', 'Kancing Kayu 15mm', 'trim', 'pcs'],
    ['zip', 'TRIM-ZIP', 'Resleting YKK 20cm', 'trim', 'pcs'],
    ['label', 'ACC-LABEL', 'Label Woven Vobia', 'accessory', 'pcs'],
    ['bag', 'ACC-POLYBAG', 'Polybag OPP 30x40', 'accessory', 'pcs'],
  ]) M[k] = await ins(
    `insert into materials(tenant_id,code,name,category,uom) values($1,$2,$3,$4,$5) returning id`,
    [T, code, name, cat, uom]);

  // --- styles / colorways / skus -----------------------------------------
  // SKU map keyed "STYLE-COLOR-SIZE" -> sku uuid
  const SKU = {};
  const styleDefs = [
    { code: 'VB-MIRA', name: 'Mira Pleated Top', coll: 'Spring 2026',
      colors: [['PINK', 'Dusty Pink'], ['SAGE', 'Sage Green']], sizes: ['S', 'M', 'L', 'XL'] },
    { code: 'VB-LUNA', name: 'Luna Wide Pants', coll: 'Spring 2026',
      colors: [['BLACK', 'Black'], ['BEIGE', 'Beige']], sizes: ['S', 'M', 'L', 'XL'] },
    { code: 'VB-ARA', name: 'Ara Linen Dress', coll: 'Resort 2026',
      colors: [['WHITE', 'White'], ['TERRA', 'Terracotta']], sizes: ['S', 'M', 'L'] },
  ];
  const STYLE = {};
  for (const s of styleDefs) {
    const sid = await ins(
      `insert into styles(tenant_id,code,name,collection) values($1,$2,$3,$4) returning id`,
      [T, s.code, s.name, s.coll]);
    STYLE[s.code] = sid;
    for (const [cc, cn] of s.colors) {
      const cwid = await ins(
        `insert into colorways(tenant_id,style_id,color_name,color_code) values($1,$2,$3,$4) returning id`,
        [T, sid, cn, cc]);
      for (const sz of s.sizes) {
        SKU[`${s.code}-${cc}-${sz}`] = await ins(
          `insert into skus(tenant_id,colorway_id,size,sku_code) values($1,$2,$3,$4) returning id`,
          [T, cwid, sz, `${s.code}-${cc}-${sz}`]);
      }
    }
  }

  // --- BOM (material per finished unit) -----------------------------------
  const bom = {
    'VB-MIRA': [['cotton', 1.2], ['btn', 5], ['label', 1], ['bag', 1]],
    'VB-LUNA': [['rayon', 1.5], ['zip', 1], ['label', 1], ['bag', 1]],
    'VB-ARA': [['rayon', 2.0], ['label', 1], ['bag', 1]],
  };
  for (const [sc, lines] of Object.entries(bom))
    for (const [mk, qty] of lines)
      await c.query(
        `insert into bom_lines(tenant_id,style_id,material_id,qty_per_unit) values($1,$2,$3,$4)`,
        [T, STYLE[sc], M[mk], qty]);

  // --- channels -----------------------------------------------------------
  const CH = {};
  for (const name of ['Shopee', 'Tokopedia', 'Offline Store'])
    CH[name] = await ins(
      `insert into channels(tenant_id,name) values($1,$2) returning id`, [T, name]);

  // ledger writers (mirror record_movement sign rules) ---------------------
  const matMove = (mat, qty, type, reason, refType, refId, loc) =>
    c.query(`insert into material_ledger
      (tenant_id,material_id,location_id,qty,movement_type,reason,ref_type,ref_id,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [T, mat, loc, ['issue_out', 'transfer_out'].includes(type) ? -Math.abs(qty) : Math.abs(qty),
       type, reason, refType, refId, UID]);
  const stockMove = (sku, qty, type, reason, refType, refId, loc) =>
    c.query(`insert into stock_ledger
      (tenant_id,sku_id,location_id,qty,movement_type,reason,ref_type,ref_id,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [T, sku, loc, ['sale_out', 'transfer_out'].includes(type) ? -Math.abs(qty) : Math.abs(qty),
       type, reason, refType, refId, UID]);

  // --- purchase orders ----------------------------------------------------
  // helper: create PO + lines, and post purchase_in for received qty
  const mkPO = async (code, vendor, status, orderDate, lines) => {
    const poid = await ins(
      `insert into purchase_orders(tenant_id,code,vendor_id,location_id,order_date,status)
       values($1,$2,$3,$4,$5,$6) returning id`,
      [T, code, vendor, LOC_MAIN, orderDate, status]);
    for (const [mk, ord, price, recv] of lines) {
      await c.query(
        `insert into purchase_lines(tenant_id,po_id,material_id,qty_ordered,unit_price,qty_received)
         values($1,$2,$3,$4,$5,$6)`, [T, poid, M[mk], ord, price, recv]);
      if (recv > 0)
        await matMove(M[mk], recv, 'purchase_in', `receive ${code}`, 'purchase_order', poid, LOC_MAIN);
    }
    return poid;
  };
  await mkPO('PO-2601', V.kain, 'received', day(-40),
    [['cotton', 500, 25000, 500], ['rayon', 400, 32000, 400]]);
  await mkPO('PO-2602', V.aks, 'received', day(-38),
    [['btn', 2000, 500, 2000], ['zip', 800, 2500, 800], ['label', 3000, 300, 3000], ['bag', 3000, 200, 3000]]);
  await mkPO('PO-2603', V.kain, 'open', day(-5),
    [['cotton', 300, 25000, 0]]);                       // fully open — nothing received yet
  await mkPO('PO-2604', V.kain, 'open', day(-8),
    [['rayon', 200, 32000, 120]]);                      // partial receive

  // --- production orders + material issue + finished-goods in -------------
  const mkProd = async (code, styleCode, stage, deadline, lines) => {
    const poid = await ins(
      `insert into production_orders(tenant_id,code,style_id,vendor_id,stage,deadline)
       values($1,$2,$3,$4,$5,$6) returning id`,
      [T, code, STYLE[styleCode], V.cmt, stage, deadline]);
    for (const [skuKey, ord, recv, rej] of lines) {
      await c.query(
        `insert into prod_lines(tenant_id,po_id,sku_id,qty_ordered,qty_received,reject_count)
         values($1,$2,$3,$4,$5,$6)`, [T, poid, SKU[skuKey], ord, recv, rej]);
      if (recv > 0)
        await stockMove(SKU[skuKey], recv, 'production_in', `receive ${code}`, 'production_order', poid, LOC_MAIN);
    }
    return poid;
  };
  const PROD1 = await mkProd('PROD-2601', 'VB-MIRA', 'mass_production', day(14),
    [['VB-MIRA-PINK-M', 60, 50, 3], ['VB-MIRA-SAGE-M', 40, 30, 2]]);
  // issue BOM materials for the Mira run (100 units) out of Gudang Utama
  for (const [mk, qty] of [['cotton', 120], ['btn', 500], ['label', 100], ['bag', 100]])
    await matMove(M[mk], qty, 'issue_out', 'issue to PROD-2601', 'production_order', PROD1, LOC_MAIN);

  const PROD2 = await mkProd('PROD-2602', 'VB-LUNA', 'qc', day(20),
    [['VB-LUNA-BLACK-M', 50, 50, 0], ['VB-LUNA-BEIGE-L', 30, 28, 1]]);
  await mkProd('PROD-2603', 'VB-ARA', 'trial', day(30),
    [['VB-ARA-WHITE-M', 20, 0, 0]]);

  // --- production costing (feeds sku_hpp view) ----------------------------
  const cost = (po, type, amt, note) => c.query(
    `insert into cost_entries(tenant_id,po_id,cost_type,amount,note) values($1,$2,$3,$4,$5)`,
    [T, po, type, amt, note]);
  await cost(PROD1, 'material', 12000000, 'kain + aksesoris');
  await cost(PROD1, 'cmt', 4000000, 'ongkos jahit CV Jahit Makmur');
  await cost(PROD1, 'overhead', 1000000, 'listrik + QC');
  await cost(PROD2, 'material', 7500000, 'rayon + resleting');
  await cost(PROD2, 'cmt', 3000000, 'ongkos jahit');

  // --- multi-location transfer (Gudang Utama -> Toko Jakarta) -------------
  await stockMove(SKU['VB-MIRA-PINK-M'], 20, 'transfer_out', 'kirim ke Toko Jakarta', 'transfer', null, LOC_MAIN);
  await stockMove(SKU['VB-MIRA-PINK-M'], 20, 'transfer_in', 'terima dari Gudang Utama', 'transfer', null, LOC_TOKO);

  // --- sales orders (sale_out from Gudang Utama) --------------------------
  const mkOrder = async (code, channel, cust, orderDate, lines) => {
    const oid = await ins(
      `insert into orders(tenant_id,code,channel_id,customer,order_date) values($1,$2,$3,$4,$5) returning id`,
      [T, code, CH[channel], cust, orderDate]);
    for (const [skuKey, qty, price] of lines) {
      await c.query(
        `insert into order_lines(tenant_id,order_id,sku_id,qty,unit_price) values($1,$2,$3,$4,$5)`,
        [T, oid, SKU[skuKey], qty, price]);
      await stockMove(SKU[skuKey], qty, 'sale_out', `sale ${code}`, 'order', oid, LOC_MAIN);
    }
    return oid;
  };
  const ORD1 = await mkOrder('ORD-2601', 'Shopee', 'Andi Wijaya', day(-3),
    [['VB-MIRA-PINK-M', 3, 185000], ['VB-MIRA-SAGE-M', 2, 185000]]);
  await mkOrder('ORD-2602', 'Tokopedia', 'Sari Melati', day(-2),
    [['VB-LUNA-BLACK-M', 4, 245000]]);
  await mkOrder('ORD-2603', 'Offline Store', 'Walk-in', day(-1),
    [['VB-LUNA-BEIGE-L', 2, 245000]]);

  // --- return (return_in) -------------------------------------------------
  const ret = await ins(
    `insert into returns(tenant_id,code,order_id,return_date,reason) values($1,$2,$3,$4,$5) returning id`,
    [T, 'RET-2601', ORD1, day(-1), 'Barang cacat jahitan']);
  await c.query(
    `insert into return_lines(tenant_id,return_id,sku_id,qty) values($1,$2,$3,$4)`,
    [T, ret, SKU['VB-MIRA-PINK-M'], 1]);
  await stockMove(SKU['VB-MIRA-PINK-M'], 1, 'return_in', 'retur ORD-2601', 'return', ret, LOC_MAIN);

  // --- P1-P3: forecast -> projection -> PCB -> PPO -> child POs -----------
  const Q = '2026-Q3';
  const STY_A = STYLE['VB-MIRA'];
  const STY_B = STYLE['VB-LUNA'];

  const fcS = await ins(`insert into forecasts(tenant_id,kind,period) values($1,'sales',$2) returning id`, [T, Q]);
  const fcO = await ins(`insert into forecasts(tenant_id,kind,period,notes) values($1,'ops',$2,'Rekomendasi ITO 4x') returning id`, [T, Q]);
  await c.query(`insert into forecast_lines(tenant_id,forecast_id,style_id,qty) values($1,$2,$3,520),($1,$2,$4,340)`, [T, fcS, STY_A, STY_B]);
  await c.query(`insert into forecast_lines(tenant_id,forecast_id,style_id,qty,ito,stock_ratio) values($1,$2,$3,450,4.2,1.15),($1,$2,$4,300,3.8,1.20)`, [T, fcO, STY_A, STY_B]);

  const NP = await ins(
    `insert into new_products(tenant_id,name,style_id,rnd_status,mkt_status,agreed_qty,notes)
     values($1,'Raya Capsule 2026',$2,'done','tervalidasi',200,'Cek ombak IG: 200 pcs aman') returning id`, [T, STY_B]);

  const PROJ = await ins(`insert into projections(tenant_id,period,status,locked_at) values($1,$2,'locked',now()) returning id`, [T, Q]);
  // trigger lock-guard menolak insert lines saat parent locked -> disable dulu (seeder jalan sbg postgres/owner)
  await c.query(`alter table projection_lines disable trigger projection_lines_lock_guard`);
  await c.query(
    `insert into projection_lines(tenant_id,projection_id,style_id,qty,kind,new_product_id)
     values($1,$2,$3,450,'regular',null),($1,$2,$4,200,'seasonal_new',$5)`, [T, PROJ, STY_A, STY_B, NP]);
  await c.query(`alter table projection_lines enable trigger projection_lines_lock_guard`);

  const PCB = await ins(`insert into pcb(tenant_id,code,quarter,projection_id) values($1,'PCB-2026Q3',$2,$3) returning id`, [T, Q, PROJ]);
  await c.query(
    `insert into pcb_lines(tenant_id,pcb_id,style_id,target_sales,ending_stock,unit_cost)
     values($1,$2,$3,450,60,165000),($1,$2,$4,200,0,120000)`, [T, PCB, STY_A, STY_B]);

  // PPO-2 (FOB) -> 1 anak finished, DP lunas + pelunasan pending
  const PPO_FOB = await ins(`insert into ppo(tenant_id,code,pcb_id,style_id,scheme,qty,status) values($1,'PPO-2',$2,$3,'fob',510,'issued') returning id`, [T, PCB, STY_A]);
  const POF = await ins(
    `insert into purchase_orders(tenant_id,code,vendor_id,location_id,ppo_id,po_type,amount,doc_status,approved_at)
     values($1,'PPO-2-A',$2,$3,$4,'finished',84150000,'approved',now()) returning id`, [T, V.cmt, LOC_MAIN, PPO_FOB]);
  await c.query(`insert into po_payments(tenant_id,po_id,kind,amount,status,paid_at) values($1,$2,'dp',25000000,'paid',now())`, [T, POF]);
  await c.query(`insert into po_payments(tenant_id,po_id,kind,amount) values($1,$2,'settlement',59150000)`, [T, POF]);

  // PPO-1 (CMT) -> 4 anak (SOP: 1A bahan, 1B jahit, 1C bordir, 1D aksesoris)
  const PPO_CMT = await ins(`insert into ppo(tenant_id,code,pcb_id,style_id,scheme,qty,status) values($1,'PPO-1',$2,$3,'cmt',200,'issued') returning id`, [T, PCB, STY_B]);
  const kinds = [['A', 'material', 9000000], ['B', 'sewing', 6000000], ['C', 'bordir', 2000000], ['D', 'accessory', 1500000]];
  for (const [sfx, typ, amt] of kinds) {
    const pid = await ins(
      `insert into purchase_orders(tenant_id,code,vendor_id,location_id,ppo_id,po_type,amount)
       values($1,$2,$3,$4,$5,$6,$7) returning id`, [T, `PPO-1-${sfx}`, V.cmt, LOC_MAIN, PPO_CMT, typ, amt]);
    if (typ === 'material')
      await c.query(`insert into purchase_lines(tenant_id,po_id,material_id,qty_ordered,unit_price) values($1,$2,$3,300,30000)`, [T, pid, M.cotton]);
    await c.query(`insert into po_payments(tenant_id,po_id,kind,amount) values($1,$2,'full',$3)`, [T, pid, amt]);
  }

  await c.query('commit');

  // --- summary ------------------------------------------------------------
  const counts = {};
  for (const t of ['styles', 'skus', 'materials', 'vendors', 'channels', 'locations',
    'purchase_orders', 'bom_lines', 'production_orders', 'cost_entries',
    'orders', 'returns', 'material_ledger', 'stock_ledger',
    'forecasts', 'projections', 'pcb', 'ppo', 'po_payments'])
    counts[t] = (await c.query(`select count(*) n from ${t} where tenant_id=$1`, [T])).rows[0].n;
  console.log('seeded:', counts);
} catch (e) {
  await c.query('rollback');
  throw e;
} finally {
  await c.end();
}
