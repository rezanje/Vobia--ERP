// Seed two role-restricted demo accounts (Sales, Ops) into the SAME tenant as an
// existing owner account, for the sales-vs-ops access-control demo.
//
//   node scripts/seed-users.mjs [owner_email]   # defaults to superadmin@vobia.com
//
// Runs as the postgres role over the pooler (SUPABASE_DB_URL in .env.local), so it
// can insert into auth.users directly. The new-user trigger (handle_new_user) fires
// on that insert and creates a brand-new tenant + role='owner' profile for each
// account; this script immediately overwrites that profile (tenant_id, role) to
// join the target tenant instead, then deletes the orphaned tenant it doesn't need.
// Idempotent: re-running just re-applies tenant_id/role on the existing accounts.

import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const DB = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
if (!DB) throw new Error('SUPABASE_DB_URL not found in .env.local');

const OWNER_EMAIL = process.argv[2] || 'superadmin@vobia.com';
const DEMO_PASSWORD = 'password123';
const DEMO_USERS = [
  { email: 'sales.demo@vobia.test', role: 'sales', full_name: 'Sales Demo' },
  { email: 'ops.demo@vobia.test', role: 'ops', full_name: 'Ops Demo' },
];

const c = new Client({ connectionString: DB });

await c.connect();
try {
  await c.query('begin');

  const { rows: [owner] } = await c.query(
    `select p.tenant_id from public.profiles p join auth.users u on u.id = p.id where u.email = $1`,
    [OWNER_EMAIL]);
  if (!owner) throw new Error(`owner ${OWNER_EMAIL} not found — sign up first`);
  const TENANT = owner.tenant_id;
  console.log('target tenant', TENANT);

  for (const du of DEMO_USERS) {
    const { rows: [existing] } = await c.query('select id from auth.users where email=$1', [du.email]);
    let uid = existing?.id;

    if (!uid) {
      // confirmation_token/recovery_token/email_change_token_new/email_change default to
      // NULL, but GoTrue's Go structs can't scan NULL for these varchar columns — leaving
      // them NULL makes signInWithPassword fail with an opaque error. Must be ''.
      const { rows: [created] } = await c.query(
        `insert into auth.users
           (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            confirmation_token, recovery_token, email_change_token_new, email_change)
         values
           ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            $1, crypt($2, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('full_name', $3::text),
            now(), now(),
            '', '', '', '')
         returning id`,
        [du.email, DEMO_PASSWORD, du.full_name]);
      uid = created.id;
      console.log('created auth user', du.email, uid);
    } else {
      console.log('auth user already exists', du.email, uid);
    }

    // handle_new_user() trigger fired on the INSERT above (fresh accounts only) and
    // created a profile pointed at a brand-new tenant with role='owner'. Repoint it.
    const { rows: [prof] } = await c.query('select tenant_id from public.profiles where id=$1', [uid]);
    const orphanTenant = prof?.tenant_id && prof.tenant_id !== TENANT ? prof.tenant_id : null;

    await c.query(
      `update public.profiles set tenant_id=$1, role=$2, full_name=$3 where id=$4`,
      [TENANT, du.role, du.full_name, uid]);

    if (orphanTenant) {
      // handle_new_user() also seeds a default location (20260709000001_locations.sql)
      // and a chart of accounts via seed_accounts() (20260713000005_accounting_seed_post.sql)
      // for the tenant it creates. Clear those children before dropping the tenant row,
      // or the delete below fails on locations_tenant_id_fkey / accounts_tenant_id_fkey.
      await c.query('delete from public.locations where tenant_id=$1', [orphanTenant]);
      await c.query('delete from public.accounts where tenant_id=$1', [orphanTenant]);
      await c.query('delete from public.tenants where id=$1 and id <> $2', [orphanTenant, TENANT]);
      console.log('cleaned up orphan tenant', orphanTenant);
    }
  }

  await c.query('commit');
  const { rows: summary } = await c.query(
    `select u.email, p.role, p.tenant_id from auth.users u join public.profiles p on p.id=u.id
      where u.email = any($1)`, [DEMO_USERS.map((d) => d.email)]);
  console.log('done:', summary);
} catch (e) {
  await c.query('rollback');
  throw e;
} finally {
  await c.end();
}
