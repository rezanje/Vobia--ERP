import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('adjustment updates the stock balance', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.sl.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'SL E2E Co' },
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
    await page.fill('input[placeholder="Style code (VB-MIRA)"]', 'SL-E2E')
    await page.fill('input[placeholder="Name"]', 'SL Top')
    await page.fill('input[placeholder="Color name (Black)"]', 'Black')
    await page.fill('input[placeholder="Code (BLK)"]', 'BLK')
    await page.getByRole('button', { name: /Save style/ }).click()
    await expect(page.getByText('SL-E2E-BLK-S')).toBeVisible()

    await page.goto('/stock')
    await page.selectOption('select', { label: 'SL-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty (e.g. 15 or -5)"]', '15')
    await page.fill('input[placeholder="Reason"]', 'initial count')
    await page.getByRole('button', { name: 'Record adjustment' }).click()

    await expect(page.getByRole('cell', { name: 'SL-E2E-BLK-S' }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: '15', exact: true }).first()).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
