import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

describe('durable Xtream favorites against initialized SQLite', () => {
    it.each([
        'refresh',
        'empty',
        'restore',
        'identity',
        'collision',
        'snapshot',
        'restore-snapshot',
        'scope',
        'lock',
        'lock-duplicate',
        'receipt',
        'conflict-latch',
        'conflict-migration',
        'compatible-actions',
    ])(
        '%s preserves the saved favorite independently of catalog rows',
        (scenario) => {
            const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-favorites-'));
            try {
                expect(
                    execFileSync(
                        createRequire(__filename)('electron'),
                        [
                            '--import',
                            'tsx',
                            resolve(__dirname, 'testing/favorites-durable.ts'),
                            scenario,
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
                    )
                ).toBe('favorites verified');
            } finally {
                rmSync(dataDir, { recursive: true, force: true });
            }
        },
        35_000
    );
});
