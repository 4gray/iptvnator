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
        [
            'json',
            {
                outputFile:
                    '../../dist/test-results/electron-backend-e2e/results.json',
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
    /* The mocks run as one node process, not through `nx run …:serve`: Nx
     * starts its command in a detached process group, so Playwright's
     * process-group kill missed it and the server kept its port after the run.
     * See docs/architecture/xtream-mock-server.md#playwright-integration. */
    webServer: [
        {
            command: 'node --import tsx apps/stalker-mock-server/src/main.ts',
            env: {
                NODE_ENV: 'development',
                TSX_TSCONFIG_PATH: 'tsconfig.base.json',
            },
            url: `http://localhost:${process.env['MOCK_PORT'] ?? '3210'}/health`,
            reuseExistingServer: !process.env['CI'],
            cwd: workspaceRoot,
        },
        {
            command: 'node --import tsx apps/xtream-mock-server/src/main.ts',
            env: {
                NODE_ENV: 'development',
                TSX_TSCONFIG_PATH: 'tsconfig.base.json',
            },
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
