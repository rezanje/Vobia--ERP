// Import the client's real SKU catalog (styles → colorways → skus + COGS/retail
// price) into a tenant, keyed by the owner account's email. Coexists with any
// existing catalog (upsert by natural keys) — safe to re-run.
//
//   node scripts/import-vobia-catalog.mjs [owner_email]   # default superadmin@vobia.com
//
// Source data: scripts/data/vobia_catalog.json — produced from
// "Bank Data Vobia NJE.xlsx" (SOURCE/SKU/Parent Sku/ARTICLE/CATEGORY/SUB
// CATEGORY/VARIANT/SUB VARIANT/STATUS/COGS/Retail Price). Mapping:
//   Parent Sku -> styles.code, VARIANT -> styles.name, CATEGORY -> collection,
//   ARTICLE -> colorways.color_name/code, SUB VARIANT -> skus.size,
//   SKU -> skus.sku_code, COGS/Retail -> skus.cogs/retail_price,
//   STATUS='Discontinue' -> skus.active=false.
//
// Runs as postgres over the pooler (SUPABASE_DB_URL in .env.local), bypassing RLS.

import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const DB = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
if (!DB) throw new Error('SUPABASE_DB_URL not found in .env.local');

const OWNER_EMAIL = process.argv[2] || 'superadmin@vobia.com';
const catalog = JSON.parse(readFileSync(new URL('./data/vobia_catalog.json', import.meta.url), 'utf8'));

const c = new Client({ connectionString: DB });
await c.connect();
try {
  await c.query('begin');

  const { rows: [owner] } = await c.query(
    `select p.tenant_id from public.profiles p join auth.users u on u.id = p.id where u.email = $1`,
    [OWNER_EMAIL]);
  if (!owner) throw new Error(`owner ${OWNER_EMAIL} not found`);
  const T = owner.tenant_id;

  let nStyle = 0, nCw = 0, nSku = 0;
  for (const st of catalog) {
    const { rows: [s] } = await c.query(
      `insert into public.styles (tenant_id, code, name, collection)
       values ($1,$2,$3,$4)
       on conflict (tenant_id, code) do update set name = excluded.name, collection = excluded.collection
       returning id`,
      [T, st.code, st.name, st.collection]);
    nStyle++;
    for (const cw of st.colorways) {
      const { rows: [w] } = await c.query(
        `insert into public.colorways (tenant_id, style_id, color_name, color_code)
         values ($1,$2,$3,$4)
         on conflict (tenant_id, style_id, color_code) do update set color_name = excluded.color_name
         returning id`,
        [T, s.id, cw.color_name, cw.color_code]);
      nCw++;
      for (const sku of cw.skus) {
        await c.query(
          `insert into public.skus (tenant_id, colorway_id, size, sku_code, cogs, retail_price, active)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (tenant_id, sku_code) do update set
             size = excluded.size, cogs = excluded.cogs,
             retail_price = excluded.retail_price, active = excluded.active`,
          [T, w.id, sku.size, sku.sku_code, sku.cogs, sku.retail_price, sku.active]);
        nSku++;
      }
    }
  }

  await c.query('commit');
  console.log(`imported into tenant ${T}: ${nStyle} styles, ${nCw} colorways, ${nSku} skus`);
} catch (e) {
  await c.query('rollback');
  throw e;
} finally {
  await c.end();
}
