/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    type InitialImportDiagnosticCapture,
    validateInitialImportDiagnosticArtifacts,
} from './initial-import-diagnostic-artifacts';
import { CPU_PROFILE } from './initial-import-diagnostic-test-fixtures';
const HEAP_META = {
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
};
const HEAP_SNAPSHOT = {
    edges: [0, 0, 0],
    nodes: [0, 0, 1, 0, 1, 0],
    snapshot: { meta: HEAP_META },
    strings: ['', 'root'],
};
const TRACE = {
    traceEvents: [{ name: 'initial-import', ph: 'X', ts: 1 }],
};

function capture(directory: string): InitialImportDiagnosticCapture {
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

async function writeArtifacts(directory: string): Promise<void> {
    const artifacts: Readonly<Record<string, unknown>> = {
        'database.worker-4.cpuprofile': CPU_PROFILE,
        'database.worker-4.heapsnapshot': HEAP_SNAPSHOT,
        'main.cpuprofile': CPU_PROFILE,
        'main.heapsnapshot': HEAP_SNAPSHOT,
        'renderer.cpuprofile': CPU_PROFILE,
        'renderer.heapsnapshot': HEAP_SNAPSHOT,
        'renderer.trace.json': TRACE,
    };
    await Promise.all(
        Object.entries(artifacts).map(([filename, value]) =>
            writeFile(join(directory, filename), JSON.stringify(value))
        )
    );
}

async function withArtifacts(
    run: (directory: string) => Promise<void>
): Promise<void> {
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-content-')
    );
    try {
        await writeArtifacts(directory);
        await run(directory);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
}

test('accepts bounded signed CPU time deltas emitted by Chromium', async () => {
    await withArtifacts(async (directory) => {
        await writeFile(
            join(directory, 'renderer.cpuprofile'),
            JSON.stringify({
                ...CPU_PROFILE,
                endTime: 5_000,
                samples: [1, 1, 1],
                timeDeltas: [1_000, -100, 1_000],
            })
        );
        await assert.doesNotReject(() =>
            validateInitialImportDiagnosticArtifacts(
                capture(directory),
                directory
            )
        );
    });
});

test('rejects CPU profiles without useful bounded samples and stack references', async () => {
    await withArtifacts(async (directory) => {
        const invalidProfiles = [
            { ...CPU_PROFILE, samples: [], timeDeltas: [] },
            { ...CPU_PROFILE, timeDeltas: undefined },
            { ...CPU_PROFILE, timeDeltas: [] },
            {
                ...CPU_PROFILE,
                endTime: CPU_PROFILE.startTime,
            },
            {
                ...CPU_PROFILE,
                samples: [2],
            },
            {
                ...CPU_PROFILE,
                timeDeltas: [-1],
            },
            {
                ...CPU_PROFILE,
                timeDeltas: [2_001],
            },
            {
                ...CPU_PROFILE,
                nodes: [
                    ...CPU_PROFILE.nodes,
                    { ...CPU_PROFILE.nodes[0], id: 1 },
                ],
            },
            {
                ...CPU_PROFILE,
                nodes: [{ id: 1 }],
            },
        ];
        for (const profile of invalidProfiles) {
            await writeFile(
                join(directory, 'main.cpuprofile'),
                JSON.stringify(profile)
            );
            await assert.rejects(
                () =>
                    validateInitialImportDiagnosticArtifacts(
                        capture(directory),
                        directory
                    ),
                /initial-import-diagnostic-artifact-invalid:main-cpu-profile/
            );
        }
    });
});

test('rejects empty or malformed heap tables and invalid field strides', async () => {
    await withArtifacts(async (directory) => {
        const invalidSnapshots = [
            { snapshot: {}, nodes: [], edges: [], strings: [] },
            { ...HEAP_SNAPSHOT, nodes: [] },
            { ...HEAP_SNAPSHOT, edges: [] },
            { ...HEAP_SNAPSHOT, strings: [] },
            {
                ...HEAP_SNAPSHOT,
                snapshot: {
                    meta: { ...HEAP_META, node_types: undefined },
                },
            },
            { ...HEAP_SNAPSHOT, nodes: [...HEAP_SNAPSHOT.nodes, 0] },
            { ...HEAP_SNAPSHOT, edges: [...HEAP_SNAPSHOT.edges, 0] },
        ];
        for (const snapshot of invalidSnapshots) {
            await writeFile(
                join(directory, 'main.heapsnapshot'),
                JSON.stringify(snapshot)
            );
            await assert.rejects(
                () =>
                    validateInitialImportDiagnosticArtifacts(
                        capture(directory),
                        directory
                    ),
                /initial-import-diagnostic-artifact-invalid:main-heap-snapshot/
            );
        }
    });
});

test('rejects empty traces and malformed trace events', async () => {
    await withArtifacts(async (directory) => {
        const invalidTraces = [
            { traceEvents: [] },
            { traceEvents: [null] },
            { traceEvents: [{ name: '', ph: 'X', ts: 1 }] },
            { traceEvents: [{ name: 'initial-import', ph: '', ts: 1 }] },
            {
                traceEvents: [
                    { name: 'initial-import', ph: 'X', ts: 'invalid' },
                ],
            },
        ];
        for (const trace of invalidTraces) {
            await writeFile(
                join(directory, 'renderer.trace.json'),
                JSON.stringify(trace)
            );
            await assert.rejects(
                () =>
                    validateInitialImportDiagnosticArtifacts(
                        capture(directory),
                        directory
                    ),
                /initial-import-diagnostic-artifact-invalid:renderer-trace/
            );
        }
    });
});
