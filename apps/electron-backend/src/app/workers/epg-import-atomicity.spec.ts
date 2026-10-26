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
        'gzip-corrupt',
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
        expect(result.after.provenance).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    source_url: 'other-source',
                    updated_at: '2000-01-01T00:00:00Z',
                }),
                expect.objectContaining({
                    channel_id: 'shared',
                    display_name: 'Updated 0',
                    updated_at: expect.not.stringMatching(/^2000-/),
                }),
            ])
        );
        expect(result.fts).toEqual({ count: 1001 });
    }, 30000);
    it('keeps the existing channel-only feed semantics', () => {
        const result = runScenario('valid', 0);
        expect(result.outcome).toBe('EPG_COMPLETE');
        expect(result.programmeCount).toEqual({ count: 2 });
        expect(result.titles).toEqual(['Other programme', 'Previous archive']);
        expect(result.fts).toEqual({ count: 0 });
    }, 30000);
    it('preserves the live guide when a worker is terminated during a download', () => {
        const result = runScenario('cancelled');
        expect(result.outcome).toBe('CANCELLED');
        expect(result.progressEvents).toBeGreaterThan(0);
        expect(isDeepStrictEqual(result.after, result.before)).toBe(true);
    }, 30000);
    it('rolls back termination after a full batch inside publication and keeps readers on the old guide', () => {
        const result = runScenario('cancelled-publish');
        expect(result.outcome).toBe('CANCELLED');
        expect(isDeepStrictEqual(result.after, result.before)).toBe(true);
        expect(result.fts).toEqual({ count: 0 });
        expect(result.readDuringPublish).toEqual([
            { title: 'Expired archive' },
            { title: 'Other programme' },
            { title: 'Previous archive' },
            { title: 'Previous programme' },
        ]);
    }, 30000);
    it('retries a failed publication with a fresh worker and no leaked staging data or locks', () => {
        const result = runScenario('retry');
        expect(result.outcome).toBe('EPG_ERROR');
        expect(isDeepStrictEqual(result.failedSnapshot, result.before)).toBe(
            true
        );
        expect(result.retryResult?.outcome).toBe('EPG_COMPLETE');
        expect(result.fts).toEqual({ count: 1001 });
        expect(result.programmeCount).toEqual({ count: 1003 });
    }, 30000);
    it('imports 137,000 programmes with a 64 MiB V8 old-generation limit', () => {
        const result = runScenario('valid', 137000);
        expect(result.outcome).toBe('EPG_COMPLETE');
        expect(result.programmeCount).toEqual({ count: 137002 });
        expect(result.metrics?.tempStore).toBe(1);
        expect(result.metrics?.stagedBytes).toBeGreaterThan(2 * 1024 * 1024);
        console.info('Large EPG publication metrics:', result.metrics);
        expect(result.fts).toEqual({ count: 137000 });
        expect(result.titles).toEqual(['Other programme', 'Previous archive']);
    }, 120000);
});
