import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { workspaceRoot } from '@nx/devkit';

process.env['IPTVNATOR_E2E_SOURCE_SYNC'] = '1';
process.env['SOURCE_SYNC_WEB_PORT'] ??= '4307';
process.env['MOCK_PORT'] ??= '3317';
process.env['XTREAM_MOCK_PORT'] ??= '3318';
const frontendUrl = `http://localhost:${process.env['SOURCE_SYNC_WEB_PORT']}`;
const mockServers = (Array.isArray(base.webServer) ? base.webServer : []).map(
    (server, index) => {
        const port =
            index === 0
                ? (process.env['MOCK_PORT'] ?? '3317')
                : (process.env['XTREAM_MOCK_PORT'] ?? '3318');
        return {
            ...server,
            env: { ...server.env, PORT: port },
            url: `http://localhost:${port}/health`,
            reuseExistingServer: false,
        };
    }
);

export default defineConfig({
    ...base,
    testMatch: ['**/source-sync.e2e.ts', '**/activity-sync.e2e.ts'],
    timeout: 180000,
    webServer: [
        ...mockServers,
        {
            command: `pnpm nx run web:serve --port=${process.env['SOURCE_SYNC_WEB_PORT']}`,
            url: frontendUrl,
            reuseExistingServer: false,
            cwd: workspaceRoot,
            timeout: 120000,
        },
    ],
});
