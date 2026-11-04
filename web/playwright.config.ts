import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome' } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 740 }, channel: process.env.CI ? undefined : 'chrome' } },
  ],
  webServer: {
    command: 'npm run dev -- --port 4173',
    url: 'http://127.0.0.1:4173',
    timeout: 60000,
    reuseExistingServer: false,
    env: {
      NUXT_PUBLIC_SIGNUP_ENABLED: 'true',
      NUXT_PUBLIC_SIGNUP_ENDPOINT: 'https://signup.example.test/subscribe',
      NUXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    },
  },
})
