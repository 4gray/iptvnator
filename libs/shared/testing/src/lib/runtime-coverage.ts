import { createRequire } from 'node:module';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Plugin } from 'esbuild';

type CoverageData = Record<string, Record<string, unknown>>;
const coverageRequire = createRequire(resolve(process.cwd(), 'package.json'));
const { createCoverageMap } = coverageRequire('istanbul-lib-coverage') as {
    createCoverageMap(data: unknown): {
        merge(data: unknown): void;
        toJSON(): CoverageData;
    };
};
const { createInstrumenter } = coverageRequire('istanbul-lib-instrument') as {
    createInstrumenter(options: unknown): {
        instrumentSync(code: string, filename: string): string;
    };
};

/** Instrument original TypeScript so subprocess/browser hits retain source locations. */
export function runtimeCoveragePlugin(include: RegExp): Plugin {
    return {
        name: 'original-runtime-coverage',
        setup(build) {
            build.onLoad({ filter: /\.ts$/ }, ({ path }) => {
                if (
                    !path.startsWith(resolve('libs') + sep) ||
                    basename(path) === 'index.ts' ||
                    !include.test(path)
                )
                    return;
                const instrumenter = createInstrumenter({
                    parserPlugins: ['typescript'],
                    esModules: true,
                    compact: false,
                });
                return {
                    contents: instrumenter.instrumentSync(
                        readFileSync(path, 'utf8'),
                        path
                    ),
                    loader: 'ts',
                    resolveDir: dirname(path),
                };
            });
        },
    };
}

export function writeRuntimeCoverage(
    file: string | undefined,
    snapshots: unknown[]
): void {
    if (!file) return;
    const merged = createCoverageMap({});
    for (const snapshot of snapshots) merged.merge(snapshot);
    writeFileSync(file, JSON.stringify(merged.toJSON()));
}

/** Return real runtime counters to Jest; a missing report fails the covered test. */
export async function withRuntimeCoverage<T>(
    run: (file?: string) => T | Promise<T>
): Promise<T> {
    const global = globalThis as typeof globalThis & {
        __coverage__?: CoverageData;
    };
    global.__coverage__ ??= {};
    mkdirSync(resolve('tmp'), { recursive: true });
    const directory = mkdtempSync(resolve('tmp/runtime-coverage-'));
    const file = join(directory, 'coverage.json');
    try {
        const result = await run(file);
        const merged = createCoverageMap(global.__coverage__);
        merged.merge(JSON.parse(readFileSync(file, 'utf8')));
        // Keep objects cached by Jest's instrumented functions alive.
        const report = JSON.parse(
            JSON.stringify(merged.toJSON())
        ) as CoverageData;
        for (const [path, entry] of Object.entries(report)) {
            if (global.__coverage__[path])
                Object.assign(global.__coverage__[path], entry);
            else global.__coverage__[path] = entry;
        }
        return result;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
