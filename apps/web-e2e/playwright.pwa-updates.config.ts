import { defineConfig, devices } from '@playwright/test';

process.env['IPTVNATOR_E2E_PWA_UPDATES'] = '1';

export default defineConfig({
    testDir: './src',
    testMatch: 'pwa-update.e2e.ts',
    workers: 1,
    timeout: 90_000,
    reporter: [
        ['list'],
        [
            'json',
            { outputFile: '../../dist/test-results/pwa-updates/results.json' },
        ],
    ],
    outputDir: '../../dist/test-results/pwa-updates',
    use: {
        ...devices['Desktop Chrome'],
        serviceWorkers: 'allow',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
});
