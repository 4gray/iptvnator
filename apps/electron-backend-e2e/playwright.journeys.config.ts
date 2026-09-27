import { workspaceRoot } from '@nx/devkit';
import { defineConfig } from '@playwright/test';

/**
 * Performance journeys (docs/architecture/performance-journeys.md). One
 * worker, no retries: every journey spawns its own Electron processes and
 * adds its entry to the run's single summary file. The Xtream mock serves both the M3U playlist
 * and the portal on a dedicated loopback port so a normal E2E server on
 * 3211 cannot be reused by accident. The mock runs as one node process
 * rather than through `nx run …:serve`, whose detached process group outlived
 * the run and kept the port. Locally a server already on the port (e.g. one
 * started by hand) is reused, since its fixtures are deterministic; CI always
 * starts its own.
 */
const xtreamMockPort =
    process.env['IPTVNATOR_JOURNEY_XTREAM_MOCK_PORT'] ?? '3231';

// One summary file per invocation: the runner loads this config before it
// forks the worker, so every journey spec sees the same start time.
process.env['IPTVNATOR_JOURNEY_RUN_STARTED_AT'] ??= new Date().toISOString();

export default defineConfig({
    fullyParallel: false,
    reporter: [['list']],
    retries: 0,
    testDir: './src/journeys',
    testMatch: '**/*.journey.ts',
    timeout: 30 * 60 * 1_000,
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
