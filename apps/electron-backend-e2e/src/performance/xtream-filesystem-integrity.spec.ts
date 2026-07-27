import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { CPU_PROFILE } from './initial-import-diagnostic-test-fixtures';
import {
    validateXtreamDiagnosticArtifacts,
    type XtreamDiagnosticCapture,
} from './xtream-diagnostic-artifacts';
import { verifyXtreamPersistenceReceipt } from './xtream-raw-persistence-receipt';

const HEAP_SNAPSHOT = {
    edges: [0, 0, 0],
    nodes: [0, 0, 1, 0, 1, 0],
    snapshot: {
        meta: {
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['context'], 'string_or_number', 'node'],
            node_fields: [
                'type',
                'name',
                'id',
                'self_size',
                'edge_count',
                'detachedness',
            ],
            node_types: [
                ['hidden'],
                'string',
                'number',
                'number',
                'number',
                'number',
            ],
        },
    },
    strings: ['', 'root'],
};
const RENDERER_TRACE = {
    traceEvents: [{ name: 'xtream-diagnostic', ph: 'X', ts: 1 }],
};
const directories: string[] = [];

afterEach(async () => {
    await Promise.all(
        directories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true }))
    );
});

describe('Xtream filesystem evidence integrity', () => {
    it('rejects a raw persistence file with an external hard-link alias', async () => {
        const directory = await createDirectory('raw');
        const outside = await createDirectory('raw-outside');
        const serialized = '{"safe":true}';
        const rawPath = join(directory, 'raw.json');
        const externalAlias = join(outside, 'external-alias.json');
        await writeFile(rawPath, serialized, 'utf8');
        await link(rawPath, externalAlias);

        await assert.rejects(
            () =>
                verifyXtreamPersistenceReceipt(serialized, {
                    absolutePath: rawPath,
                    bytes: Buffer.byteLength(serialized),
                    sha256: sha256(serialized),
                }),
            /^Error: invalid Xtream persistence receipt$/
        );
    });

    it('rejects a diagnostic artifact with an external hard-link alias', async () => {
        const directory = await createDirectory('diagnostic');
        const outside = await createDirectory('outside');
        await writeValidArtifacts(directory);
        const tracePath = join(directory, 'renderer.trace.json');
        const externalTrace = join(outside, 'renderer.trace.json');
        await unlink(tracePath);
        await writeFile(externalTrace, JSON.stringify(RENDERER_TRACE));
        await link(externalTrace, tracePath);

        await assert.rejects(
            () =>
                validateXtreamDiagnosticArtifacts(
                    capture(directory),
                    directory
                ),
            /^Error: xtream-diagnostic-artifact-path-invalid:renderer-trace$/
        );
    });
});

function capture(directory: string): XtreamDiagnosticCapture {
    return {
        main: {
            cpuProfilePath: join(directory, 'main.cpuprofile'),
            heapSnapshotPath: join(directory, 'main.heapsnapshot'),
            workers: [
                {
                    kind: 'database.worker',
                    ordinal: 4,
                    profilePath: join(
                        directory,
                        'database.worker-4.cpuprofile'
                    ),
                    snapshotPath: join(
                        directory,
                        'database.worker-4.heapsnapshot'
                    ),
                },
            ],
        },
        renderer: {
            cpuProfilePath: join(directory, 'renderer.cpuprofile'),
            heapSnapshotPath: join(directory, 'renderer.heapsnapshot'),
            tracePath: join(directory, 'renderer.trace.json'),
        },
    };
}

async function createDirectory(label: string): Promise<string> {
    const directory = await mkdtemp(
        join(tmpdir(), `iptvnator-xtream-fs-${label}-`)
    );
    directories.push(directory);
    return directory;
}

async function writeValidArtifacts(directory: string): Promise<void> {
    await Promise.all([
        writeJson(join(directory, 'main.cpuprofile'), CPU_PROFILE),
        writeJson(join(directory, 'renderer.cpuprofile'), CPU_PROFILE),
        writeJson(join(directory, 'database.worker-4.cpuprofile'), CPU_PROFILE),
        writeJson(
            join(directory, 'database.worker-4.heapsnapshot'),
            HEAP_SNAPSHOT
        ),
        writeJson(join(directory, 'main.heapsnapshot'), HEAP_SNAPSHOT),
        writeJson(join(directory, 'renderer.heapsnapshot'), HEAP_SNAPSHOT),
        writeJson(join(directory, 'renderer.trace.json'), RENDERER_TRACE),
    ]);
}

function writeJson(path: string, value: unknown): Promise<void> {
    return writeFile(path, JSON.stringify(value));
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
