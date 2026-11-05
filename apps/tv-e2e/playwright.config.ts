import { tvOrigins, tvPorts } from './ports';
import { defineConfig } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
export default defineConfig({
    ...nxE2EPreset(__filename, { testDir: './src' }),
    testMatch: '**/*.e2e.ts',
    workers: 1,
    timeout: 45000,
    use: {
        baseURL: tvOrigins.app,
        viewport: { width: 1920, height: 1080 },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    reporter: [
        ['list'],
        ['json', { outputFile: '../../dist/test-results/tv-e2e/results.json' }],
    ],
    webServer: [
        {
            command: 'node --import tsx apps/web-backend/src/main.ts',
            env: {
                PORT: String(tvPorts.library),
                CLIENT_URL: `${tvOrigins.app},null`,
                IPTVNATOR_STORAGE: 'server',
                IPTVNATOR_ACCESS_TOKEN: 'tv-library-test',
                IPTVNATOR_DATA_DIR: `${workspaceRoot}/tmp/tv-library-e2e-${process.pid}`,
                TSX_TSCONFIG_PATH: 'tsconfig.base.json',
            },
            url: `${tvOrigins.library}/health`,
            cwd: workspaceRoot,
            reuseExistingServer: false,
        },
        {
            command: `pnpm exec vite preview --config apps/tv/vite.config.ts --host 127.0.0.1 --port ${tvPorts.app} --strictPort`,
            url: tvOrigins.app,
            cwd: workspaceRoot,
            reuseExistingServer: false,
        },
        {
            command: 'node --import tsx apps/web-backend/src/main.ts',
            env: {
                PORT: String(tvPorts.backend),
                CLIENT_URL: `${tvOrigins.app},null`,
                IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS: '1',
                TSX_TSCONFIG_PATH: 'tsconfig.base.json',
            },
            url: `${tvOrigins.backend}/health`,
            cwd: workspaceRoot,
            reuseExistingServer: false,
        },
        {
            command: 'node --import tsx apps/xtream-mock-server/src/main.ts',
            env: {
                XTREAM_MOCK_PORT: String(tvPorts.xtream),
                TSX_TSCONFIG_PATH: 'tsconfig.base.json',
            },
            url: `${tvOrigins.xtream}/health`,
            cwd: workspaceRoot,
            reuseExistingServer: false,
        },
        {
            command: 'node --import tsx apps/stalker-mock-server/src/main.ts',
            env: {
                MOCK_PORT: String(tvPorts.stalker),
                TSX_TSCONFIG_PATH: 'tsconfig.base.json',
            },
            url: `${tvOrigins.stalker}/health`,
            cwd: workspaceRoot,
            reuseExistingServer: false,
        },
    ],
});
