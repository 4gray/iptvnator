import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type {
    EpgImportScenario,
    runEpgImportScenario,
} from './testing/epg-import-scenario';

function runScenario(
    scenario: EpgImportScenario,
    programmeCount = 1001
): Awaited<ReturnType<typeof runEpgImportScenario>> {
    const moduleUrl = pathToFileURL(
        resolve(__dirname, 'testing/epg-import-scenario.ts')
    ).href;
    const script = `const { runEpgImportScenario } = await import(${JSON.stringify(moduleUrl)});
        const result = await runEpgImportScenario(${JSON.stringify(scenario)}, ${programmeCount});
        process.stdout.write('RESULT:' + JSON.stringify(result));`;
    const output = execFileSync(
        createRequire(__filename)('electron'),
        ['--input-type=module', '--import', 'tsx', '--eval', script],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 120000,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                TSX_TSCONFIG_PATH: resolve('tsconfig.base.json'),
            },
        }
    );
    const result = output
        .split('\n')
        .find((line) => line.startsWith('RESULT:'));
    if (!result) throw new Error('Missing EPG scenario result');
    return JSON.parse(result.slice(7));
}

describe('atomic XMLTV import through the real Electron parser worker', () => {
    it.each([
        'malformed',
        'truncated',
        'gzip-error',
        'write-error',
        'empty',
    ] as const)(
        'preserves the previous guide, source timestamps and mappings after %s',
        (scenario) => {
            const result = runScenario(scenario);
            expect(result.outcome).toBe('EPG_ERROR');
            if (scenario !== 'empty')
                expect(result.progressEvents).toBeGreaterThan(0);
            expect(isDeepStrictEqual(result.after, result.before)).toBe(true);
            expect(result.fts).toEqual({ count: 0 });
        },
        30000
    );
    it('commits a complete feed, retains recent archives and other sources, and updates FTS', () => {
        const result = runScenario('valid');
        expect(result.outcome).toBe('EPG_COMPLETE');
        expect(result.titles).toHaveLength(1003);
        expect(result.titles).toEqual(
            expect.arrayContaining([
                'New 1000',
                'Previous archive',
                'Other programme',
            ])
        );
        expect(result.titles).not.toContain('Previous programme');
        expect(result.titles).not.toContain('Expired archive');
        expect(result.after.mappings).toEqual(result.before.mappings);
        expect(result.fts).toEqual({ count: 1001 });
    }, 30000);
    it('preserves the live guide when a worker is terminated during a download', () => {
        const result = runScenario('cancelled');
        expect(result.outcome).toBe('CANCELLED');
        expect(result.progressEvents).toBeGreaterThan(0);
        expect(isDeepStrictEqual(result.after, result.before)).toBe(true);
    }, 30000);
    it('imports 137,000 programmes with a 64 MiB V8 old-generation limit', () => {
        const result = runScenario('valid', 137000);
        expect(result.outcome).toBe('EPG_COMPLETE');
        expect(result.programmeCount).toEqual({ count: 137002 });
        expect(result.fts).toEqual({ count: 137000 });
        expect(result.titles).toEqual(['Other programme', 'Previous archive']);
    }, 120000);
});
