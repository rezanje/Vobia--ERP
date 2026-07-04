import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Drives the real browser flow: log in → session established → the dashboard
// renders only THIS user's tenant-scoped profile (RLS + JWT tenant claim).
// The signup path is verified separately at the API level; here we seed a
// confirmed user via the admin API so the test doesn't depend on the project's
// email-confirmation setting.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('login renders the tenant-scoped dashboard', async ({ page }) => {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const email = `vobia.e2e.${Date.now()}@gmail.com`
  const password = 'password123'

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { tenant_name: 'E2E Co', full_name: 'E2E User' },
  })
  expect(error).toBeNull()
  const userId = created!.user!.id

  try {
    await page.goto('/login')
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    // a brand-new tenant has zero cross-tenant data → both empty states render
    await expect(page.getByText('Tidak ada SKU oversold. Semua saldo aman.')).toBeVisible()
    await expect(page.getByText('Belum ada order.')).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
