import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('transfer moves stock from the default location to a second location', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.trf.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'TRF E2E Co' },
  })
  expect(error).toBeNull()
  const userId = created!.user!.id

  try {
    await page.goto('/login')
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')
    // Generous timeout: first hit compiles the route chain on the dev server.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 })

    // Create a style -> gives us SKU TRF-E2E-BLK-S
    await page.goto('/styles/new')
    await page.fill('input[placeholder="VB-KJ06"]', 'TRF-E2E')
    await page.fill('input[placeholder="Nama style"]', 'TRF Top')
    await page.fill('input[placeholder="Batik Navy"]', 'Black')
    await page.fill('input[placeholder="BNV"]', 'BLK')
    await page.getByRole('button', { name: 'Simpan Style' }).click()
    await expect(page.getByText('TRF-E2E-BLK-S')).toBeVisible()

    // Ensure a second location "Toko Kedua" exists
    await page.goto('/locations')
    if (await page.getByText('Toko Kedua', { exact: true }).count() === 0) {
      await page.fill('input[placeholder="Toko Bandung"]', 'Toko Kedua')
      await page.getByRole('button', { name: 'Simpan Lokasi' }).click()
      await expect(page.getByText('Toko Kedua', { exact: true })).toBeVisible()
    }

    // Seed stock at the default location (Gudang Utama) via the adjust form
    await page.goto('/stock')
    const adjustCard = page.locator('.vb-card', { has: page.getByText('Penyesuaian Stok') })
    await adjustCard.locator('select').selectOption({ label: 'TRF-E2E-BLK-S' })
    await adjustCard.locator('input[placeholder="-2"]').fill('10')
    await adjustCard.locator('input[placeholder="Stock opname"]').fill('seed')
    await adjustCard.getByRole('button', { name: 'Simpan' }).click()

    const balanceCard = page.locator('.vb-card', { has: page.getByText('Saldo per Lokasi') })
    await expect(balanceCard.getByText('Gudang Utama').first()).toBeVisible({ timeout: 15_000 })
    await expect(balanceCard.getByText('10', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

    // Transfer 1 unit from Gudang Utama to Toko Kedua
    const transferCard = page.locator('.vb-card', { has: page.getByText('Transfer Antar Lokasi') })
    await transferCard.locator('select').nth(0).selectOption({ label: 'TRF-E2E-BLK-S' })
    await transferCard.locator('select').nth(1).selectOption({ label: 'Gudang Utama' })
    await transferCard.locator('select').nth(2).selectOption({ label: 'Toko Kedua' })
    await transferCard.locator('input[placeholder="6"]').fill('1')
    await transferCard.getByRole('button', { name: 'Transfer' }).click()

    // Ledger shows a Transfer Masuk row
    const movesCard = page.locator('.vb-card', { has: page.getByText('Pergerakan Terakhir') })
    await expect(movesCard.getByText('Transfer Masuk')).toBeVisible({ timeout: 15_000 })
    await expect(movesCard.getByText('Transfer Keluar')).toBeVisible()

    // Per-location balances now show Toko Kedua holding stock
    await expect(balanceCard.getByText('Toko Kedua')).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
