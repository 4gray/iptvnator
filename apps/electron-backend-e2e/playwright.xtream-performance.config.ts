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
        // One node process (not `nx run`) so the run's kill reaches it.
        command: 'node --import tsx apps/xtream-mock-server/src/main.ts',
        cwd: workspaceRoot,
        env: {
            HOST: '127.0.0.1',
            IPTVNATOR_XTREAM_MOCK_CONTROL: '1',
            IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN: controlToken,
            NODE_ENV: 'development',
            PORT: '3221',
            TSX_TSCONFIG_PATH: 'tsconfig.base.json',
        },
        reuseExistingServer: false,
        url: 'http://127.0.0.1:3221/health',
    },
    workers: 1,
});
