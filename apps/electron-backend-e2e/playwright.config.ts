import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Electron e2e tests.
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './src',
  /* Match .e2e.ts files */
  testMatch: '**/*.e2e.ts',
  /* Run tests sequentially since we're testing an Electron app */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env['CI'],
  /* Retry on CI only */
  retries: process.env['CI'] ? 2 : 0,
  /* Single worker since we're testing an Electron app */
  workers: 1,
  /* Reporter to use */
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../dist/playwright-report/electron-backend-e2e' }],
  ],
  /* Shared settings for all the projects below */
  use: {
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    /* Screenshots on failure */
    screenshot: 'on',
    /* Video on failure */
    video: 'on-first-retry',
  },
  /* Output folder for test artifacts */
  outputDir: '../../dist/test-results/electron-backend-e2e',
  /* Timeout for each test */
  timeout: 60000,
  /* Timeout for expect() assertions */
  expect: {
    timeout: 10000,
  },
  projects: [
    {
      name: 'electron',
      use: {},
    },
  ],
});
