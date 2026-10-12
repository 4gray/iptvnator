import { workspaceRoot } from '@nx/devkit';
import { defineConfig } from '@playwright/test';

/**
 * Compositing report (`pnpm run perf:compositing`,
 * docs/architecture/performance-journeys.md#compositing-budget). One worker,
 * no retries. The Xtream mock runs on a dedicated loopback port so a normal
 * E2E server on 3211 cannot be reused by accident; the test fixtures read the
 * port from `XTREAM_MOCK_PORT`, which this config sets for the worker.
 */
const xtreamMockPort =
    process.env['IPTVNATOR_COMPOSITING_XTREAM_MOCK_PORT'] ?? '3233';
process.env['XTREAM_MOCK_PORT'] = xtreamMockPort;

export default defineConfig({
    fullyParallel: false,
    outputDir: '../../dist/test-results/electron-backend-e2e/compositing',
    reporter: [['list']],
    retries: 0,
    testDir: './src/compositing',
    testMatch: '**/*.report.ts',
    timeout: 15 * 60 * 1_000,
    use: {
        testIdAttribute: 'data-test-id',
    },
    webServer: {
        command: 'node --import tsx apps/xtream-mock-server/src/main.ts',
        cwd: workspaceRoot,
        env: {
            HOST: '127.0.0.1',
            NODE_ENV: 'development',
            PORT: xtreamMockPort,
            TSX_TSCONFIG_PATH: 'tsconfig.base.json',
        },
        reuseExistingServer: !process.env['CI'],
        url: `http://127.0.0.1:${xtreamMockPort}/health`,
    },
    workers: 1,
});
