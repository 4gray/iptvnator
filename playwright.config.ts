import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 45000,
    maxFailures: 2,
    testMatch: /.*\.e2e\.ts/,
    webServer: {
        command: 'npm run serve',
        port: 4200,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
    },
    use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4200',
        headless: false,
        screenshot: 'only-on-failure',
        testIdAttribute: 'data-test-id',
    },
});
