import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('database initialization across skipped releases (#1580)', () => {
    it.each(['0.19.0', '0.20.0', '0.21.0', '0.22.0', '0.23.0', 'fresh'])(
        'preserves %s data and indexes across upgrade and repeated startup',
        (version) => {
            const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-upgrade-'));
            const electronPath = createRequire(__filename)(
                'electron'
            ) as string;
            const fixture =
                version === 'fresh'
                    ? 'fresh'
                    : resolve(
                          __dirname,
                          'testing/fixtures',
                          `v${version}-schema.sql`
                      );
            try {
                const output = execFileSync(
                    electronPath,
                    [
                        '--import',
                        'tsx',
                        resolve(__dirname, 'testing/connection-upgrade.ts'),
                        fixture,
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
                expect(output).toBe('upgrade verified');
            } finally {
                rmSync(dataDir, { recursive: true, force: true });
            }
        },
        35_000
    );
});
