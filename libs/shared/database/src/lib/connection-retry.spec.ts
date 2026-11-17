import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('database initialization retry after a failed attempt', () => {
    it('closes the failed handle and opens a migrated database on the next call', () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-retry-'));
        const electronPath = createRequire(__filename)('electron') as string;
        try {
            const output = execFileSync(
                electronPath,
                [
                    '--import',
                    'tsx',
                    resolve(__dirname, 'testing/connection-retry.ts'),
                ],
                {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    timeout: 30_000,
                    env: {
                        ...process.env,
                        ELECTRON_RUN_AS_NODE: '1',
                        IPTVNATOR_E2E_DATA_DIR: dataDir,
                        TSX_TSCONFIG_PATH: resolve(
                            process.cwd(),
                            'tsconfig.base.json'
                        ),
                    },
                }
            );
            expect(output).toBe('retry verified');
        } finally {
            rmSync(dataDir, { recursive: true, force: true });
        }
    }, 35_000);
});
