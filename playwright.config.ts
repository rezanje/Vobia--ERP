import { defineConfig } from '@playwright/test'

// Port 3100 (not 3000) so E2E never collides with another local dev server.
const PORT = 3100

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
