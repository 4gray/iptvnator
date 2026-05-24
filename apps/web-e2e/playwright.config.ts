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
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        baseURL,
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
    },
    /* Run local dev servers before starting the tests.
     * Both the Angular app and the Stalker mock server start in parallel.
     * Set MOCK_PORT to override the default mock server port (3210).
     */
    webServer: [
        {
            command: webServerCommand,
            url: baseURL,
            reuseExistingServer: reuseExistingWebServer,
            cwd: workspaceRoot,
        },
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
        {
            command: 'pnpm nx run web-backend:serve',
            url: 'http://localhost:3333/health',
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
