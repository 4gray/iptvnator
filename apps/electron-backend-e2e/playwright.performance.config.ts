import { defineConfig } from '@playwright/test';

export default defineConfig({
    fullyParallel: false,
    reporter: [['list']],
    testDir: './src',
    testMatch: '**/*.performance.ts',
    timeout: 30 * 60 * 1_000,
    use: {
        testIdAttribute: 'data-test-id',
    },
    workers: 1,
});
