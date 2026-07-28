import { randomBytes } from 'node:crypto';

import { workspaceRoot } from '@nx/devkit';
import { defineConfig } from '@playwright/test';

const controlToken =
    process.env['IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN'] ??
    randomBytes(32).toString('base64url');
process.env['IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN'] = controlToken;

export default defineConfig({
    fullyParallel: false,
    reporter: [['list']],
    retries: 0,
    testDir: './src',
    testMatch: 'xtream.performance.ts',
    timeout: 30 * 60 * 1_000,
    use: {
        testIdAttribute: 'data-test-id',
    },
    webServer: {
        command: 'pnpm nx run xtream-mock-server:serve',
        cwd: workspaceRoot,
        env: {
            HOST: '127.0.0.1',
            IPTVNATOR_XTREAM_MOCK_CONTROL: '1',
            IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN: controlToken,
            PORT: '3221',
        },
        reuseExistingServer: false,
        url: 'http://127.0.0.1:3221/health',
    },
    workers: 1,
});
