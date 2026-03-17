import { defineConfig } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

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
        [
            'html',
            {
                outputFolder:
                    '../../dist/playwright-report/electron-backend-e2e',
            },
        ],
    ],
    /* Shared settings for all the projects below */
    use: {
        /* Align with the app's existing test ids */
        testIdAttribute: 'data-test-id',
        /* Collect trace when retrying the failed test */
        trace: 'on-first-retry',
        /* Screenshots on failure */
        screenshot: 'on',
        /* Video on failure */
        video: 'on-first-retry',
    },
    webServer: [
        {
            command: 'pnpm nx run stalker-mock-server:serve',
            url: `http://localhost:${process.env['MOCK_PORT'] ?? '3210'}/health`,
            reuseExistingServer: !process.env['CI'],
            cwd: workspaceRoot,
        },
        {
            command: 'pnpm nx run xtream-mock-server:serve',
            url: `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}/health`,
            reuseExistingServer: !process.env['CI'],
            cwd: workspaceRoot,
        },
    ],
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
