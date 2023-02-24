import { devices, PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
    testDir: './e2e',
    timeout: 45000,
    maxFailures: 2,
    testMatch: /.*\.e2e\.ts/,
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                serviceWorkers: 'block',
            },
        },
        /* {
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox'],
                serviceWorkers: 'block',
            },
        },
        {
            name: 'webkit',
            use: {
                ...devices['Desktop Safari'],
                serviceWorkers: 'block',
            },
        }, */
    ],
    use: {
        headless: false,
        screenshot: 'only-on-failure',
        testIdAttribute: 'data-test-id',
    },
};

export default config;
