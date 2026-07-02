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
    await expect(page.getByText('Vobia ERP')).toBeVisible()

    await page.goto('/styles/new')
    await page.fill('input[placeholder="Style code (VB-MIRA)"]', 'CO-E2E')
    await page.fill('input[placeholder="Name"]', 'CO Top')
    await page.fill('input[placeholder="Color name (Black)"]', 'Black')
    await page.fill('input[placeholder="Code (BLK)"]', 'BLK')
    await page.getByRole('button', { name: /Save style/ }).click()
    await expect(page.getByText('CO-E2E-BLK-S')).toBeVisible()

    await page.goto('/vendors')
    await page.fill('input[placeholder="Name"]', 'Vendor CO')
    await page.getByRole('button', { name: 'Add vendor' }).click()
    await expect(page.getByRole('cell', { name: 'Vendor CO' })).toBeVisible()

    await page.goto('/production/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { index: 1 })
    await page.selectOption('select >> nth=2', { label: 'CO-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty ordered"]', '100')
    await page.getByRole('button', { name: 'Create order' }).click()

    await expect(page.getByText('CO-E2E-BLK-S')).toBeVisible()
    await page.locator('tbody input').first().fill('100')
    await page.getByRole('button', { name: 'Save' }).first().click()
    await page.getByRole('button', { name: '→ mass_production' }).click()
    await page.getByRole('button', { name: '→ qc' }).click()
    await page.getByRole('button', { name: '→ completed' }).click()

    await page.fill('input[placeholder="Amount"]', '5000')
    await page.getByRole('button', { name: 'Add cost' }).click()
    await expect(page.getByRole('cell', { name: '5,000' }).first()).toBeVisible()

    await page.goto('/costing')
    await expect(page.getByRole('cell', { name: 'CO-E2E-BLK-S' })).toBeVisible()
    await expect(page.getByRole('cell', { name: '50', exact: true })).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
