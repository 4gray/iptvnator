import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

describe('opt-in activity persistence in real SQLite', () => {
    it.each(['fresh', '0.19.0', '0.24.0'])(
        'preserves %s user data and survives reopen/rollback',
        (version) => {
            const electron = createRequire(__filename)('electron') as string;
            const result = execFileSync(
                electron,
                [
                    '--import',
                    'tsx',
                    resolve(__dirname, '../testing/activity-storage.ts'),
                    version,
                ],
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
        }
    );
});
