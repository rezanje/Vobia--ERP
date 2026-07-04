import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('add cost on a completed PO shows HPP', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.co.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'CO E2E Co' },
  })
  expect(error).toBeNull()
  const userId = created!.user!.id

  try {
    await page.goto('/login')
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.goto('/styles/new')
    await page.fill('input[placeholder="VB-KJ06"]', 'CO-E2E')
    await page.fill('input[placeholder="Nama style"]', 'CO Top')
    await page.fill('input[placeholder="Batik Navy"]', 'Black')
    await page.fill('input[placeholder="BNV"]', 'BLK')
    await page.getByRole('button', { name: 'Simpan Style' }).click()
    await expect(page.getByText('CO-E2E-BLK-S')).toBeVisible()

    await page.goto('/vendors')
    await page.fill('input[placeholder="CV Maju Garmen"]', 'Vendor CO')
    await page.getByRole('button', { name: 'Simpan Vendor' }).click()
    await expect(page.getByText('Vendor CO')).toBeVisible()

    await page.goto('/production/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { index: 1 })
    await page.selectOption('select >> nth=2', { label: 'CO-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '100')
    await page.getByRole('button', { name: 'Buat Order Produksi' }).click()

    await expect(page.getByText('CO-E2E-BLK-S')).toBeVisible()
    await page.locator('.vb-row input').first().fill('100')
    await page.getByRole('button', { name: 'Simpan' }).first().click()
    await page.getByRole('button', { name: '→ Mass Prod' }).click()
    await page.getByRole('button', { name: '→ QC' }).click()
    await page.getByRole('button', { name: '→ Selesai' }).click()
    await expect(page.locator('button', { hasText: '→' })).toHaveCount(0)

    // add a cost of 5000 -> HPP 50
    await page.fill('input[placeholder="5000000"]', '5000')
    await page.getByRole('button', { name: 'Tambah' }).click()
    await expect(page.getByText('5.000').first()).toBeVisible()

    await page.goto('/costing')
    await expect(page.getByText('CO-E2E-BLK-S')).toBeVisible()
    await expect(page.getByText('50', { exact: true })).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
