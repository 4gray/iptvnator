import { devices, PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
    testDir: './e2e',
    maxFailures: 2,
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
        screenshot: 'only-on-failure',
        testIdAttribute: 'data-test-id',
    },
};

export default config;
