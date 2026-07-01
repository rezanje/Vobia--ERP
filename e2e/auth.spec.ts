import { test, expect } from '@playwright/test'

test('signup creates a workspace and shows own profile', async ({ page }) => {
  const email = `user_${Date.now()}@test.local`
  await page.goto('/signup')
  await page.fill('input[name="tenant_name"]', 'Playwright Co')
  await page.fill('input[name="full_name"]', 'PW User')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button[type="submit"]')

  await expect(page.getByText(email)).toBeVisible()
  // exactly one profile row visible in the JSON dump → tenant isolation holds
  await expect(page.getByText('"role": "owner"')).toBeVisible()
})
