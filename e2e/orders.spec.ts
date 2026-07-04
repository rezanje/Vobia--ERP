import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('creating an order posts sale_out and lowers stock', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.ord.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'ORD E2E Co' },
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
    await page.fill('input[placeholder="VB-KJ06"]', 'ORD-E2E')
    await page.fill('input[placeholder="Nama style"]', 'ORD Top')
    await page.fill('input[placeholder="Batik Navy"]', 'Black')
    await page.fill('input[placeholder="BNV"]', 'BLK')
    await page.getByRole('button', { name: 'Simpan Style' }).click()
    await expect(page.getByText('ORD-E2E-BLK-S')).toBeVisible()

    await page.goto('/stock')
    await page.selectOption('select', { label: 'ORD-E2E-BLK-S' })
    await page.fill('input[placeholder="-2"]', '100')
    await page.fill('input[placeholder="Stock opname"]', 'seed')
    await page.getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByText('100', { exact: true }).first()).toBeVisible()

    await page.goto('/channels')
    await page.fill('input[placeholder="Zalora"]', 'Shopee E2E')
    await page.getByRole('button', { name: 'Simpan Channel' }).click()
    await expect(page.getByText('Shopee E2E')).toBeVisible()

    await page.goto('/orders/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { label: 'ORD-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '30')
    await page.fill('input[placeholder="Harga"]', '50000')
    await page.getByRole('button', { name: 'Simpan Order' }).click()
    await expect(page.getByText('ORD-E2E-BLK-S')).toBeVisible()

    await page.goto('/stock')
    await expect(page.getByText('70', { exact: true }).first()).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
