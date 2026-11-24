import { defineConfig, devices } from '@playwright/test'

// The suite runs against the production build served by `vite preview`, the same files Vercel serves.
// `npm run test:e2e` builds first; set E2E_PORT if 4817 is taken.
const port = Number(process.env.E2E_PORT ?? 4817)

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
})
