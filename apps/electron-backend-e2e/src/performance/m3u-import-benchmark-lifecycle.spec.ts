import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
    assertM3uImportOutputPathHasNoSymlinks,
    assertM3uImportSourceState,
    M3U_IMPORT_RENDERER_CDP_PORT,
    resolveM3uImportRendererCdpPort,
    resolveM3uImportOutputLayout,
} from './m3u-import-benchmark-support';
import { assertM3uImportRequestDelta } from './m3u-import.benchmark';

describe('initial M3U import benchmark lifecycle', () => {
    it('keeps requested output and variant strictly below dist/performance', () => {
        const workspaceRoot = resolve('/workspace/iptvnator');
        const outputRoot = resolve(
            workspaceRoot,
            'dist/performance/20260727T040000Z-m3u-import'
        );
        assert.deepEqual(
            resolveM3uImportOutputLayout(workspaceRoot, outputRoot, 'baseline'),
            {
                outputRoot,
                variantDirectory: resolve(outputRoot, 'baseline'),
            }
        );

        for (const requestedRoot of [
            'dist/performance/run',
            resolve(workspaceRoot, 'dist/performance'),
            resolve(workspaceRoot, 'dist/performance-sibling/run'),
            resolve(workspaceRoot, '../outside'),
        ]) {
            assert.throws(
                () =>
                    resolveM3uImportOutputLayout(
                        workspaceRoot,
                        requestedRoot,
                        'baseline'
                    ),
                /absolute path below dist\/performance/
            );
        }
        assert.throws(
            () =>
                resolveM3uImportOutputLayout(
                    workspaceRoot,
                    outputRoot,
                    '../escape'
                ),
            /variant is invalid/i
        );
    });

    it('requires a clean source tree for formal runs but permits dirty smoke evidence', () => {
        const dirtyState = {
            commit: 'a'.repeat(40),
            diffSha256: 'b'.repeat(64),
            dirty: true,
        };

        assert.throws(
            () => assertM3uImportSourceState(false, dirtyState),
            /Formal performance runs require a clean Git worktree/
        );
        assert.doesNotThrow(() => assertM3uImportSourceState(true, dirtyState));
        assert.doesNotThrow(() =>
            assertM3uImportSourceState(false, {
                ...dirtyState,
                dirty: false,
            })
        );
    });

    it('rejects an existing output ancestor symlink before artifact creation', async () => {
        const fixtureRoot = await mkdtemp(
            join(tmpdir(), 'iptvnator-m3u-output-path-')
        );
        const repositoryRoot = join(fixtureRoot, 'repository');
        const performanceRoot = join(
            repositoryRoot,
            'dist',
            'performance'
        );
        const outside = join(fixtureRoot, 'outside');
        await mkdir(performanceRoot, { recursive: true });
        await mkdir(outside);
        await symlink(outside, join(performanceRoot, 'redirect'));

        try {
            await assert.rejects(
                assertM3uImportOutputPathHasNoSymlinks(
                    repositoryRoot,
                    join(performanceRoot, 'redirect', 'run')
                ),
                /Performance output path contains a symbolic link/
            );
            await assert.doesNotReject(
                assertM3uImportOutputPathHasNoSymlinks(
                    repositoryRoot,
                    join(performanceRoot, 'ordinary', 'run')
                )
            );
        } finally {
            await rm(fixtureRoot, { force: true, recursive: true });
        }
    });

    it('keeps formal CDP capture on 9222 while allowing an isolated smoke port', () => {
        assert.equal(
            resolveM3uImportRendererCdpPort(false, undefined),
            M3U_IMPORT_RENDERER_CDP_PORT
        );
        assert.equal(
            resolveM3uImportRendererCdpPort(false, '9222'),
            M3U_IMPORT_RENDERER_CDP_PORT
        );
        assert.equal(resolveM3uImportRendererCdpPort(true, '9322'), 9322);

        assert.throws(
            () => resolveM3uImportRendererCdpPort(false, '9322'),
            /Formal performance runs require CDP port 9222/
        );
        for (const invalid of ['0', '1023', '65536', '9222.5', 'not-a-port']) {
            assert.throws(
                () => resolveM3uImportRendererCdpPort(true, invalid),
                /IPTVNATOR_PERF_CDP_PORT is invalid/
            );
        }
    });

    it('fails closed unless one and only one app GET occurs', () => {
        assert.doesNotThrow(() => assertM3uImportRequestDelta(3, 4));
        assert.throws(
            () => assertM3uImportRequestDelta(3, 3),
            /exactly one application GET/
        );
        assert.throws(
            () => assertM3uImportRequestDelta(3, 5),
            /exactly one application GET/
        );
    });

    it('waits for the exact upsert plus route-reload GET sequence', () => {
        const source = readFileSync(
            resolve(
                process.cwd(),
                'src/performance/m3u-import.benchmark.ts'
            ),
            'utf8'
        );

        assert.match(source, /status\.databaseRequests\s*===\s*2/);
        assert.match(source, /status\.databaseUpsertsCompleted\s*===\s*1/);
        assert.match(source, /status\.databaseGetsCompleted\s*===\s*1/);
        assert.match(source, /status\.databasePending\s*===\s*0/);
    });

    it('always disposes renderer capture before closing Electron on iteration failure', () => {
        const source = readFileSync(
            resolve(
                process.cwd(),
                'src/performance/m3u-import.benchmark.ts'
            ),
            'utf8'
        );
        const runIteration = source.indexOf('async function runIteration');
        const finallyBlock = source.indexOf('} finally {', runIteration);
        const rendererDispose = source.indexOf(
            'await renderer.dispose()',
            finallyBlock
        );
        const appClose = source.indexOf('await closeElectronApp(app)', finallyBlock);

        assert.ok(finallyBlock > runIteration);
        assert.ok(rendererDispose > finallyBlock);
        assert.ok(appClose > rendererDispose);
    });
});
