import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import {
    runtimeCoveragePlugin,
    withRuntimeCoverage,
} from '@iptvnator/shared/testing/runtime-coverage';

export interface ElectronHarnessOptions {
    /** Source files whose subprocess counters count toward Jest coverage. */
    readonly coverage: RegExp;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeout: number;
}

/**
 * Runs a real-SQLite harness under Electron as Node (better-sqlite3 is built
 * for Electron's ABI) and returns its stdout. The harness is bundled with
 * the selected sources instrumented, and its counters are merged into the
 * Jest run, so code exercised only in the subprocess is reported as covered.
 */
export async function runElectronHarness(
    entry: string,
    args: readonly string[],
    options: ElectronHarnessOptions
): Promise<string> {
    return withRuntimeCoverage(async (coverageFile) => {
        const electron = createRequire(__filename)('electron') as string;
        let command = ['--import', 'tsx', entry];
        if (coverageFile) {
            const bundled = join(
                dirname(coverageFile),
                basename(entry).replace(/\.ts$/, '.cjs')
            );
            await build({
                entryPoints: [entry],
                outfile: bundled,
                bundle: true,
                platform: 'node',
                format: 'cjs',
                tsconfig: resolve('tsconfig.base.json'),
                external: ['better-sqlite3', 'electron'],
                plugins: [runtimeCoveragePlugin(options.coverage)],
                define: { __dirname: JSON.stringify(dirname(entry)) },
                footer: {
                    js: "process.on('exit', () => require('node:fs').writeFileSync(process.env.IPTVNATOR_TEST_COVERAGE_FILE, JSON.stringify(globalThis.__coverage__ ?? {})));",
                },
            });
            command = [bundled];
        }
        return execFileSync(electron, [...command, ...args], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: options.timeout,
            env: {
                ...process.env,
                ...options.env,
                ELECTRON_RUN_AS_NODE: '1',
                ...(coverageFile
                    ? { IPTVNATOR_TEST_COVERAGE_FILE: coverageFile }
                    : {}),
                TSX_TSCONFIG_PATH: resolve(process.cwd(), 'tsconfig.base.json'),
            },
        });
    });
}
