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
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.goto('/styles/new')
    await page.fill('input[placeholder="VB-KJ06"]', 'SL-E2E')
    await page.fill('input[placeholder="Nama style"]', 'SL Top')
    await page.fill('input[placeholder="Batik Navy"]', 'Black')
    await page.fill('input[placeholder="BNV"]', 'BLK')
    await page.getByRole('button', { name: 'Simpan Style' }).click()
    await expect(page.getByText('SL-E2E-BLK-S')).toBeVisible()

    await page.goto('/stock')
    await page.selectOption('select', { label: 'SL-E2E-BLK-S' })
    await page.fill('input[placeholder="-2"]', '15')
    await page.fill('input[placeholder="Stock opname"]', 'initial count')
    await page.getByRole('button', { name: 'Simpan' }).click()

    await expect(page.getByText('SL-E2E-BLK-S').first()).toBeVisible()
    await expect(page.getByText('15', { exact: true }).first()).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
