import { workspaceRoot } from '@nx/devkit';
import { defineConfig } from '@playwright/test';

/**
 * Performance journeys (docs/architecture/performance-journeys.md). One
 * worker, no retries: every journey spawns its own Electron processes and
 * writes one summary per run. The Xtream mock serves both the M3U playlist
 * and the portal on a dedicated loopback port so a normal E2E server on
 * 3211 cannot be reused by accident. Locally a server left behind by an
 * earlier run on that port is reused (its fixtures are deterministic); CI
 * always starts its own.
 */
const xtreamMockPort =
    process.env['IPTVNATOR_JOURNEY_XTREAM_MOCK_PORT'] ?? '3231';

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
        command: 'pnpm nx run xtream-mock-server:serve',
        cwd: workspaceRoot,
        env: {
            HOST: '127.0.0.1',
            PORT: xtreamMockPort,
        },
        reuseExistingServer: !process.env['CI'],
        url: `http://127.0.0.1:${xtreamMockPort}/health`,
    },
    workers: 1,
});
