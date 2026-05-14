import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://127.0.0.1:4200';
const allBrowserProjects = process.env['E2E_ALL_BROWSERS'] === '1';

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
            command:
                'node ./node_modules/nx/dist/bin/nx.js run web:serve --host 127.0.0.1 --port 4200 --no-tui',
            url: 'http://127.0.0.1:4200',
            reuseExistingServer: !process.env['CI'],
            cwd: workspaceRoot,
            timeout: 120_000,
        },
        {
            command:
                'node ./node_modules/nx/dist/bin/nx.js run stalker-mock-server:serve',
            url: `http://127.0.0.1:${process.env['MOCK_PORT'] ?? '3210'}/health`,
            reuseExistingServer: !process.env['CI'],
            cwd: workspaceRoot,
            timeout: 120_000,
        },
        {
            command:
                'node ./node_modules/nx/dist/bin/nx.js run xtream-mock-server:serve',
            url: `http://127.0.0.1:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}/health`,
            reuseExistingServer: !process.env['CI'],
            cwd: workspaceRoot,
            timeout: 120_000,
        },
    ],
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },

        ...(allBrowserProjects
            ? [
                  {
                      name: 'firefox',
                      use: { ...devices['Desktop Firefox'] },
                  },

                  {
                      name: 'webkit',
                      use: { ...devices['Desktop Safari'] },
                  },
              ]
            : []),

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
