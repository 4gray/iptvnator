import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
    createRendererArtifactCapture,
    startRendererDiagnosticCapture,
    stopRendererDiagnosticCapture,
    takeRendererHeapSnapshot,
} from './m3u-import-renderer-artifacts';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(
        directories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true }))
    );
});

test('creates renderer raw profiles exclusively with owner-only permissions', async () => {
    const directory = await createDirectory();
    const session = new FakeCdpSession();
    const artifacts = createRendererArtifactCapture({
        diagnostic: true,
        outputDirectory: directory,
    });

    await startRendererDiagnosticCapture(session as never, artifacts);
    await stopRendererDiagnosticCapture(session as never, artifacts);
    await takeRendererHeapSnapshot(
        session as never,
        artifacts.heapSnapshotPath
    );

    for (const filename of [
        'renderer.cpuprofile',
        'renderer.heapsnapshot',
        'renderer.trace.json',
    ]) {
        assert.equal(
            (await stat(join(directory, filename))).mode & 0o777,
            0o600,
            filename
        );
    }
});

test('never replaces an existing renderer CPU profile', async () => {
    const directory = await createDirectory();
    const profilePath = join(directory, 'renderer.cpuprofile');
    await writeFile(profilePath, 'original', 'utf8');
    const session = new FakeCdpSession();
    const artifacts = createRendererArtifactCapture({
        diagnostic: true,
        outputDirectory: directory,
    });

    await startRendererDiagnosticCapture(session as never, artifacts);
    await assert.rejects(
        stopRendererDiagnosticCapture(session as never, artifacts),
        { code: 'EEXIST' }
    );
    assert.equal(await readFile(profilePath, 'utf8'), 'original');
});

test('uses exclusive owner-only writes for main and worker raw artifacts', async () => {
    const source = await readFile(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );

    assert.match(
        source,
        /fs\.writeFileSync\(\s*record\.profilePath,[\s\S]{0,220}flag: 'wx',[\s\S]{0,80}mode: 0o600/
    );
    assert.match(
        source,
        /fs\.createWriteStream\(record\.snapshotPath,\s*\{[\s\S]{0,80}flags: 'wx',[\s\S]{0,80}mode: 0o600/
    );
    assert.match(
        source,
        /fs\.writeFileSync\(\s*state\.mainProfilePath,[\s\S]{0,220}flag: 'wx',[\s\S]{0,80}mode: 0o600/
    );
    assert.match(
        source,
        /fs\.createWriteStream\(\s*state\.mainSnapshotPath,\s*\{[\s\S]{0,80}flags: 'wx',[\s\S]{0,80}mode: 0o600/
    );
});

class FakeCdpSession extends EventEmitter {
    async send(method: string): Promise<Record<string, unknown>> {
        if (method === 'Profiler.stop') {
            return {
                profile: {
                    endTime: 2,
                    nodes: [{ callFrame: {}, hitCount: 1, id: 1 }],
                    samples: [1],
                    startTime: 1,
                    timeDeltas: [1],
                },
            };
        }
        if (method === 'Tracing.end') {
            this.emit('Tracing.tracingComplete');
        }
        if (method === 'HeapProfiler.takeHeapSnapshot') {
            this.emit('HeapProfiler.addHeapSnapshotChunk', {
                chunk: '{"snapshot":{}}',
            });
        }
        return {};
    }
}

async function createDirectory(): Promise<string> {
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-performance-artifact-')
    );
    directories.push(directory);
    return directory;
}
