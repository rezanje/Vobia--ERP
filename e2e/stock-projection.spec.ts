import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Data disiapkan lewat service role, bukan lewat layar lain, supaya tes ini hanya
// gagal kalau layar Proyeksi Stok yang bermasalah.
// Angka yang diharapkan: stok 15, forecast 100, cover 1.5
//   butuh ceil(100 x 1.5) = 150 -> order 150 - 15 = 135, stok awal 150, stok akhir 50.
test('forecast jual memunculkan usulan order sesuai cover 1.5x', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.sp.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'SP E2E Co' },
  })
  expect(error).toBeNull()
  const userId = created!.user!.id

  try {
    const { data: profile } = await admin.from('profiles').select('tenant_id').eq('id', userId).single()
    const tenantId = profile!.tenant_id

    const { data: style } = await admin.from('styles')
      .insert({ tenant_id: tenantId, code: 'SP-E2E', name: 'SP Top' }).select('id').single()
    const { data: cw } = await admin.from('colorways')
      .insert({ tenant_id: tenantId, style_id: style!.id, color_name: 'Black', color_code: 'BLK' })
      .select('id').single()
    const { data: sku } = await admin.from('skus')
      .insert({ tenant_id: tenantId, colorway_id: cw!.id, size: 'M', sku_code: 'SP-E2E-BLK-M',
                cogs: 10000, retail_price: 50000 })
      .select('id').single()
    const { data: loc } = await admin.from('locations')
      .select('id').eq('tenant_id', tenantId).eq('is_default', true).single()

    await admin.from('vendors').insert({ tenant_id: tenantId, name: 'Vendor Proyeksi' })
    await admin.from('vendors').insert({ tenant_id: tenantId, name: 'Vendor MOQ Besar', moq: 10000 })

    const { error: ledgerErr } = await admin.from('stock_ledger').insert({
      tenant_id: tenantId, sku_id: sku!.id, location_id: loc!.id,
      qty: 15, movement_type: 'adjustment', reason: 'seed proyeksi',
    })
    expect(ledgerErr).toBeNull()

    await page.goto('/login')
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.goto('/stock-projection')
    await expect(page.getByRole('heading', { name: 'Proyeksi Stok' })).toBeVisible()

    // sebelum ada forecast: tidak ada usulan order, stok hanya diteruskan
    const row = page.locator('.vb-row', { hasText: 'SP-E2E-BLK-M' }).first()
    await expect(row).toBeVisible()

    await row.locator('input').fill('100')
    await page.getByRole('button', { name: /^Simpan Forecast/ }).click()

    const after = page.locator('.vb-row', { hasText: 'SP-E2E-BLK-M' }).first()
    await expect(after.locator('div').filter({ hasText: /^135$/ })).toBeVisible()  // usulan order
    await expect(after.locator('div').filter({ hasText: /^150$/ })).toBeVisible()  // stok awal
    await expect(after.locator('div').filter({ hasText: /^50$/ })).toBeVisible()   // stok akhir

    // lead time bawaan 2 bulan: kedatangan bulan ini seharusnya sudah dipesan 2 bulan lalu
    await expect(after).toContainText('Telat')

    // vendor dengan MOQ lebih besar dari usulan: tombol terkunci + alasannya tampil
    await page.selectOption('select:below(:text("Buat Order Produksi"))', { label: 'Vendor MOQ Besar (MOQ 10.000)' })
    await expect(page.getByText(/Di bawah MOQ vendor/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Buat Order' })).toBeDisabled()

    // usulan -> order produksi sungguhan
    await page.selectOption('select:below(:text("Buat Order Produksi"))', { label: 'Vendor Proyeksi' })
    await page.getByRole('button', { name: 'Buat Order' }).click()
    await expect(page).toHaveURL(/\/production\/[0-9a-f-]{36}$/)
    await expect(page.getByText('SP-E2E-BLK-M')).toBeVisible()

    // kembali ke proyeksi: barang sudah dipesan, usulannya harus hilang (bukan dobel)
    await page.goto('/stock-projection')
    const settled = page.locator('.vb-row', { hasText: 'SP-E2E-BLK-M' }).first()
    await expect(settled.locator('div').filter({ hasText: /^135$/ })).toBeVisible()  // kolom Sudah Dipesan
    await expect(page.getByRole('button', { name: 'Buat Order' })).toHaveCount(0)
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
