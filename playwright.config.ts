import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5174';
const apiURL = process.env.E2E_API_URL || 'http://127.0.0.1:5100';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  globalSetup: path.resolve(__dirname, 'e2e/global-setup.ts'),
  webServer: [
    {
      command: 'npm run dev --workspace=server',
      url: `${apiURL}/ready`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        ENV_FILE: '.env.e2e',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'npm run dev --workspace=client -- --mode e2e --host 127.0.0.1 --port 5174',
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
