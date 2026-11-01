import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { build } from 'esbuild';
import {
    runtimeCoveragePlugin,
    withRuntimeCoverage,
} from '@iptvnator/shared/testing/runtime-coverage';

describe('opt-in activity persistence in real SQLite', () => {
    it.each(['fresh', '0.19.0', '0.24.0'])(
        'preserves %s user data and survives reopen/rollback',
        async (version) =>
            withRuntimeCoverage(async (coverageFile) => {
                const electron = createRequire(__filename)(
                    'electron'
                ) as string;
                let entry = resolve(
                    __dirname,
                    '../testing/activity-storage.ts'
                );
                let imports = ['--import', 'tsx'];
                if (coverageFile) {
                    const originalDirectory = dirname(entry);
                    const bundled = join(
                        dirname(coverageFile),
                        'activity-storage.cjs'
                    );
                    await build({
                        entryPoints: [entry],
                        outfile: bundled,
                        bundle: true,
                        platform: 'node',
                        format: 'cjs',
                        tsconfig: resolve('tsconfig.base.json'),
                        external: ['better-sqlite3'],
                        plugins: [
                            runtimeCoveragePlugin(
                                /activity-sqlite-|activity-schema[.]ts$|activity-storage[.]ts$/
                            ),
                        ],
                        define: {
                            __dirname: JSON.stringify(originalDirectory),
                        },
                        footer: {
                            js: `process.on('exit', () => require('node:fs').writeFileSync(${JSON.stringify(coverageFile)}, JSON.stringify(globalThis.__coverage__ ?? {})));`,
                        },
                    });
                    entry = bundled;
                    imports = [];
                }
                const result = execFileSync(
                    electron,
                    [...imports, entry, version],
                    {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        timeout: 30_000,
                        env: {
                            ...process.env,
                            ELECTRON_RUN_AS_NODE: '1',
                            TSX_TSCONFIG_PATH: resolve(
                                process.cwd(),
                                'tsconfig.base.json'
                            ),
                        },
                    }
                );
                expect(result).toBe('activity storage verified');
            })
    );
});
