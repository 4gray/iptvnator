import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The title index upgrade on real SQLite: the startup half, the batched
 * build the database worker runs, concurrent writes, an interrupted build
 * and an old runtime. See testing/content-title-fts-scenarios.ts.
 */
describe('content title FTS index upgrade (real SQLite)', () => {
    it.each([
        'small catalog rebuilds at startup',
        'kill switch rebuilds a large catalog at startup',
        'large 0.22 catalog builds in batches beside the live index',
        'interrupted build keeps the live index and resumes',
        'large 0.21 catalog without an index stays consistent',
        'runtime without diacritic folding builds the plain index',
        'a done marker over an unfolded live index is not trusted',
    ])(
        '%s',
        (scenario) => {
            const dir = mkdtempSync(join(tmpdir(), 'iptvnator-fts-'));
            const electronPath = createRequire(__filename)(
                'electron'
            ) as string;
            try {
                const output = execFileSync(
                    electronPath,
                    [
                        '--import',
                        'tsx',
                        resolve(
                            __dirname,
                            'testing/content-title-fts-scenarios.ts'
                        ),
                        scenario,
                        dir,
                    ],
                    {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        timeout: 30_000,
                        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
                    }
                );
                expect(output).toBe('verified');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
        35_000
    );
});
