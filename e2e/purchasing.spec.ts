import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('purchase order → partial receive posts material stock', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.pur.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'PUR E2E Co' },
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

    // Ensure a material E2E-FAB exists (fabric / m)
    await page.goto('/materials')
    if (await page.getByText('E2E-FAB', { exact: true }).count() === 0) {
      const matForm = page.locator('.vb-card', { has: page.getByText('Bahan Baru') })
      await matForm.locator('input[placeholder="FAB-001"]').fill('E2E-FAB')
      await matForm.locator('input[placeholder="Katun Combed 30s"]').fill('Kain')
      await matForm.locator('input[placeholder="m / pcs / roll / kg"]').fill('m')
      await matForm.getByRole('button', { name: 'Simpan Bahan' }).click()
      await expect(page.getByText('E2E-FAB', { exact: true })).toBeVisible({ timeout: 15_000 })
    }

    // Ensure a vendor E2E Vendor exists
    await page.goto('/vendors')
    if (await page.getByText('E2E Vendor', { exact: true }).count() === 0) {
      const vendForm = page.locator('.vb-card', { has: page.getByText('Vendor Baru') })
      await vendForm.locator('input[placeholder="CV Maju Garmen"]').fill('E2E Vendor')
      await vendForm.getByRole('button', { name: 'Simpan Vendor' }).click()
      await expect(page.getByText('E2E Vendor', { exact: true })).toBeVisible({ timeout: 15_000 })
    }

    // Create a PO: vendor + one line (E2E-FAB, qty 100, price 15000)
    await page.goto('/purchasing')
    const poForm = page.locator('.vb-card', { has: page.getByText('PO Bahan Baru') })
    // selects order: 0 = vendor, 1 = location, 2 = first line material
    await poForm.locator('select').nth(0).selectOption({ label: 'E2E Vendor' })
    await poForm.locator('select').nth(2).selectOption({ label: 'E2E-FAB · Kain' })
    await poForm.locator('input[placeholder="Qty"]').fill('100')
    await poForm.locator('input[placeholder="Harga/unit"]').fill('15000')
    await poForm.getByRole('button', { name: 'Buat PO' }).click()

    // Server action redirects to the PO detail page
    await expect(page).toHaveURL(/\/purchasing\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    const receiveCard = page.locator('.vb-card', { has: page.getByText('Penerimaan') })
    await expect(receiveCard.getByText('E2E-FAB', { exact: true })).toBeVisible({ timeout: 15_000 })

    // Receive a partial qty of 40 for the line
    const lineRow = receiveCard.locator('.vb-row', { hasText: 'E2E-FAB' })
    await lineRow.locator('input.vb-input').fill('40')
    await receiveCard.getByRole('button', { name: 'Terima Bahan' }).click()

    // Line now shows Diterima 40 and Sisa 60
    await expect(lineRow).toContainText('40', { timeout: 15_000 })
    await expect(lineRow).toContainText('60')

    // Material stock now shows a balance of 40 at the default location
    await page.goto('/material-stock')
    const balanceCard = page.locator('.vb-card', { has: page.getByText('Saldo per Lokasi') })
    const balanceRow = balanceCard.locator('.vb-row', { hasText: 'E2E-FAB' })
    await expect(balanceRow).toBeVisible({ timeout: 15_000 })
    await expect(balanceRow).toContainText('40')
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
