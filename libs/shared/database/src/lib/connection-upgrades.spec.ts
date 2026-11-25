import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runElectronHarness } from './testing/run-electron-harness';

describe('database initialization across skipped releases (#1580)', () => {
    it.each([
        '0.19.0',
        '0.20.0',
        '0.21.0',
        '0.22.0',
        '0.23.0',
        '0.24.0',
        '0.19.0-duplicates',
        '0.19.0-orphans',
        '0.24.0-orphans',
        'fresh',
        'rollback',
    ])(
        'preserves %s data and indexes across upgrade and repeated startup',
        (version) => {
            const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-upgrade-'));
            const electronPath = createRequire(__filename)(
                'electron'
            ) as string;
            const fixture =
                version === 'fresh' || version === 'rollback'
                    ? version
                    : resolve(
                          __dirname,
                          'testing/fixtures',
                          `v${version.replace(/-(duplicates|orphans)$/, '')}-schema.sql`
                      );
            try {
                const output = execFileSync(
                    electronPath,
                    [
                        '--import',
                        'tsx',
                        resolve(__dirname, 'testing/connection-upgrade.ts'),
                        fixture,
                        version.endsWith('-duplicates')
                            ? 'deduplicate'
                            : version.endsWith('-orphans')
                              ? 'orphans'
                              : '',
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

describe('title index upgrade on a populated catalog', () => {
    it.each([
        ['0.21.0', 'unindexed'],
        ['0.22.0', 'indexed'],
    ])(
        'defers the %s catalog rebuild to the worker and finishes it',
        async (version, kind) => {
            const dataDir = mkdtempSync(
                join(tmpdir(), 'iptvnator-fts-upgrade-')
            );
            try {
                const output = await runElectronHarness(
                    resolve(__dirname, 'testing/content-title-fts-upgrade.ts'),
                    [
                        resolve(
                            __dirname,
                            'testing/fixtures',
                            `v${version}-schema.sql`
                        ),
                        kind,
                    ],
                    {
                        coverage: /content-title-fts-upgrade[.]ts$/,
                        env: { IPTVNATOR_E2E_DATA_DIR: dataDir },
                        timeout: 60_000,
                    }
                );
                expect(output).toBe('upgrade verified');
            } finally {
                rmSync(dataDir, { recursive: true, force: true });
            }
        },
        65_000
    );
});
