import { defineConfig, devices } from '@playwright/test'

const host = '127.0.0.1'
const port = 4173
const baseURL = `http://${host}:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 45_000,
  expect: {
    timeout: 15_000,
  },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'line',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '/tmp/onerway-payment-showcase-playwright',
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: `pnpm exec nuxt dev --host ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      ONERWAY_PROFILE: 'production',
      ONERWAY_PRODUCTION_ENABLED: 'false',
      ONERWAY_PRODUCTION_BASE_URL: 'https://acq.onerway.com',
      ONERWAY_PRODUCTION_SDK_URL: '',
      ONERWAY_PRODUCTION_NOTIFY_URL: '',
      ONERWAY_PRODUCTION_MERCHANT_NO: '',
      ONERWAY_PRODUCTION_APP_ID: '',
      ONERWAY_PRODUCTION_SECRET: '',
    },
  },
})
