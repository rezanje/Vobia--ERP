import pg from 'pg'
import { readFileSync } from 'node:fs'

const { Client } = pg
const files = process.argv.slice(2)
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
c.on('notice', (n) => console.log(n.message))
await c.connect()
await c.query('create extension if not exists pgtap with schema extensions;')
let failed = false
for (const f of files) {
  console.log(`\n=== ${f} ===`)
  try {
    const res = await c.query(readFileSync(f, 'utf8'))
    for (const r of Array.isArray(res) ? res : [res]) {
      for (const row of r?.rows ?? []) {
        const v = Object.values(row).join(' ').trim()
        if (v) { console.log(v); if (/^not ok/i.test(v) || /^# Looks like you failed/i.test(v)) failed = true }
      }
    }
  } catch (e) { console.log('ERROR:', e.message); failed = true }
  await c.query('rollback').catch(() => {})
}
await c.end()
console.log('\n' + (failed ? 'RESULT: FAIL' : 'RESULT: PASS'))
process.exit(failed ? 1 : 0)
