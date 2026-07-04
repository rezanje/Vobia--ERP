import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('production order completes and posts stock', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.pv.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'PV E2E Co' },
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
    await page.fill('input[placeholder="VB-KJ06"]', 'PV-E2E')
    await page.fill('input[placeholder="Nama style"]', 'PV Top')
    await page.fill('input[placeholder="Batik Navy"]', 'Black')
    await page.fill('input[placeholder="BNV"]', 'BLK')
    await page.getByRole('button', { name: 'Simpan Style' }).click()
    await expect(page.getByText('PV-E2E-BLK-S')).toBeVisible()

    await page.goto('/vendors')
    await page.fill('input[placeholder="CV Maju Garmen"]', 'Vendor E2E')
    await page.getByRole('button', { name: 'Simpan Vendor' }).click()
    await expect(page.getByText('Vendor E2E')).toBeVisible()

    await page.goto('/production/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { index: 1 })
    await page.selectOption('select >> nth=2', { label: 'PV-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '50')
    await page.getByRole('button', { name: 'Buat Order Produksi' }).click()

    await expect(page.getByText('PV-E2E-BLK-S')).toBeVisible()
    const recv = page.locator('.vb-row input').first()
    await recv.fill('50')
    await page.getByRole('button', { name: 'Simpan' }).first().click()
    await page.getByRole('button', { name: '→ Mass Prod' }).click()
    await page.getByRole('button', { name: '→ QC' }).click()
    await page.getByRole('button', { name: '→ Selesai' }).click()
    // completed is terminal → no more transition buttons remain
    await expect(page.locator('button', { hasText: '→' })).toHaveCount(0)

    await page.goto('/stock')
    await expect(page.getByText('PV-E2E-BLK-S').first()).toBeVisible()
    await expect(page.getByText('50', { exact: true }).first()).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
