import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('create a style expands to SKUs and shows them on detail', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.ps.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'PS E2E Co' },
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
    await page.fill('input[placeholder="VB-KJ06"]', 'VB-E2E')
    await page.fill('input[placeholder="Nama style"]', 'E2E Top')
    await page.fill('input[placeholder="Batik Navy"]', 'Black')
    await page.fill('input[placeholder="BNV"]', 'BLK')
    await page.getByRole('button', { name: 'Simpan Style' }).click()

    await expect(page.getByText('VB-E2E-BLK-S')).toBeVisible()
    await expect(page.getByText('VB-E2E-BLK-M')).toBeVisible()
    await expect(page.getByText('VB-E2E-BLK-L')).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
