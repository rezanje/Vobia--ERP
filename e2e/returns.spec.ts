import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('a return posts return_in and raises stock back', async ({ page }) => {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const email = `vobia.ret.${Date.now()}@gmail.com`
  const password = 'password123'
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { tenant_name: 'RET E2E Co' },
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
    await page.fill('input[placeholder="VB-KJ06"]', 'RET-E2E')
    await page.fill('input[placeholder="Nama style"]', 'RET Top')
    await page.fill('input[placeholder="Batik Navy"]', 'Black')
    await page.fill('input[placeholder="BNV"]', 'BLK')
    await page.getByRole('button', { name: 'Simpan Style' }).click()
    await expect(page.getByText('RET-E2E-BLK-S')).toBeVisible()

    await page.goto('/stock')
    await page.selectOption('select', { label: 'RET-E2E-BLK-S' })
    await page.fill('input[placeholder="-2"]', '100')
    await page.fill('input[placeholder="Stock opname"]', 'seed')
    await page.getByRole('button', { name: 'Simpan' }).click()
    await expect(page.getByText('100', { exact: true }).first()).toBeVisible()

    await page.goto('/channels')
    await page.fill('input[placeholder="Zalora"]', 'Shopee RET')
    await page.getByRole('button', { name: 'Simpan Channel' }).click()
    await expect(page.getByText('Shopee RET')).toBeVisible()

    await page.goto('/orders/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { label: 'RET-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '30')
    await page.getByRole('button', { name: 'Simpan Order' }).click()
    await expect(page.getByText('RET-E2E-BLK-S')).toBeVisible()

    await page.goto('/returns/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { label: 'RET-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '10')
    await page.getByRole('button', { name: 'Simpan Retur' }).click()
    await expect(page.getByText('RET-E2E-BLK-S')).toBeVisible()

    await page.goto('/stock')
    await expect(page.getByText('80', { exact: true }).first()).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
