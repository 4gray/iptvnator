import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

const isStaticPwaE2E = process.env['IPTVNATOR_E2E_STATIC_PWA'] === '1';
const staticPwaPort = process.env['IPTVNATOR_E2E_STATIC_PORT'] ?? '4300';
// For CI, you may want to set BASE_URL to the deployed application.
const baseURL =
    process.env['BASE_URL'] ||
    (isStaticPwaE2E
        ? `http://localhost:${staticPwaPort}`
        : 'http://localhost:4200');
const webServerCommand =
    isStaticPwaE2E
        ? `pnpm nx run web:serve-static --port=${staticPwaPort}`
        : 'pnpm nx run web:serve';
const reuseExistingWebServer = isStaticPwaE2E ? false : !process.env['CI'];
const webBackendPort = process.env['WEB_BACKEND_PORT'] ?? '3333';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    ...nxE2EPreset(__filename, { testDir: './src' }),
    testMatch: ['**/*.e2e.ts'],
    reporter: [
        ['list'],
        [
            'html',
            {
                outputFolder: '../../dist/playwright-report/web-e2e',
            },
        ],
        [
            'json',
            {
                outputFile: '../../dist/test-results/web-e2e/results.json',
            },
        ],
    ],
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        baseURL,
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
    },
    /* Run local dev servers before starting the tests.
     * Both the Angular app and the Stalker mock server start in parallel.
     *
     * MOCK_PORT / XTREAM_MOCK_PORT relocate a mock for the whole run: the
     * health checks below and the specs' MOCK_SERVER constants read them, and
     * both mock servers honour them as a fallback for PORT (their serve
     * targets no longer pin PORT, so an explicit shell value reaches the
     * process). That is what lets two worktrees run E2E side by side when one
     * already holds 3210/3211. WEB_BACKEND_PORT does the same for the web
     * backend and self-hosted.e2e.ts, which is the only spec that calls it.
     */
    webServer: [
        {
            command: webServerCommand,
            url: baseURL,
            reuseExistingServer: reuseExistingWebServer,
            cwd: workspaceRoot,
        },
        /* The mocks run as one node process, not through `nx run …:serve`:
         * Nx starts its command in a detached process group, so Playwright's
         * process-group kill missed it and the server kept its port. */
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
        /* Same single-process launch for the backend; `env` mirrors the
         * `web-backend:serve` target, which stays the manual entry point. */
        {
            command: 'node --import tsx apps/web-backend/src/main.ts',
            env: {
                PORT: webBackendPort,
                CLIENT_URL: 'http://localhost:4200',
                BACKEND_URL: '/api',
                IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS: '1',
                TSX_TSCONFIG_PATH: 'tsconfig.base.json',
            },
            url: `http://localhost:${webBackendPort}/health`,
            reuseExistingServer: !process.env['CI'],
            cwd: workspaceRoot,
        },
    ],
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },

        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },

        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },

        // Uncomment for mobile browsers support
        /* {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    }, */

        // Uncomment for branded browsers
        /* {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    } */
    ],
});
