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
    await expect(page.getByText('Vobia ERP')).toBeVisible()

    await page.goto('/styles/new')
    await page.fill('input[placeholder="Style code (VB-MIRA)"]', 'RET-E2E')
    await page.fill('input[placeholder="Name"]', 'RET Top')
    await page.fill('input[placeholder="Color name (Black)"]', 'Black')
    await page.fill('input[placeholder="Code (BLK)"]', 'BLK')
    await page.getByRole('button', { name: /Save style/ }).click()
    await expect(page.getByText('RET-E2E-BLK-S')).toBeVisible()

    await page.goto('/stock')
    await page.selectOption('select', { label: 'RET-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty (e.g. 15 or -5)"]', '100')
    await page.fill('input[placeholder="Reason"]', 'seed')
    await page.getByRole('button', { name: 'Record adjustment' }).click()
    await expect(page.getByRole('cell', { name: '100', exact: true }).first()).toBeVisible()

    await page.goto('/channels')
    await page.fill('input[placeholder="Name (Shopee, Offline…)"]', 'Shopee RET')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByRole('cell', { name: 'Shopee RET' })).toBeVisible()

    await page.goto('/orders/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { label: 'RET-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '30')
    await page.getByRole('button', { name: /Create order/ }).click()
    await expect(page.getByText('RET-E2E-BLK-S')).toBeVisible()

    await page.goto('/returns/new')
    await page.selectOption('select >> nth=0', { index: 1 })
    await page.selectOption('select >> nth=1', { label: 'RET-E2E-BLK-S' })
    await page.fill('input[placeholder="Qty"]', '10')
    await page.getByRole('button', { name: /Create return/ }).click()
    await expect(page.getByText('RET-E2E-BLK-S')).toBeVisible()

    await page.goto('/stock')
    await expect(page.getByRole('cell', { name: '80', exact: true }).first()).toBeVisible()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})
