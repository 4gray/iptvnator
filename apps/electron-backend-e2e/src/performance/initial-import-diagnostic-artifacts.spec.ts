/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CPU_PROFILE } from './initial-import-diagnostic-test-fixtures';

interface DiagnosticCapture {
    readonly main: {
        readonly cpuProfilePath: string | null;
        readonly heapSnapshotPath: string | null;
        readonly workers: readonly {
            readonly kind: string;
            readonly ordinal: number;
            readonly profilePath: string | null;
            readonly snapshotPath: string | null;
        }[];
    };
    readonly renderer: {
        readonly cpuProfilePath: string | null;
        readonly heapSnapshotPath: string | null;
        readonly tracePath: string | null;
    };
}

interface DiagnosticArtifactsModule {
    validateInitialImportDiagnosticArtifacts?: (
        capture: DiagnosticCapture,
        iterationDirectory: string
    ) => Promise<void>;
}

const diagnosticArtifactsModulePromise = import(
    new URL('./initial-import-diagnostic-artifacts.ts', import.meta.url).href
)
    .then((module) => module as DiagnosticArtifactsModule)
    .catch(() => null);

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
    traceEvents: [{ name: 'initial-import', ph: 'X', ts: 1 }],
};

function capture(directory: string, databaseOrdinal = 4): DiagnosticCapture {
    return {
        main: {
            cpuProfilePath: join(directory, 'main.cpuprofile'),
            heapSnapshotPath: join(directory, 'main.heapsnapshot'),
            workers: [
                {
                    kind: 'database.worker',
                    ordinal: databaseOrdinal,
                    profilePath: join(
                        directory,
                        `database.worker-${databaseOrdinal}.cpuprofile`
                    ),
                    snapshotPath: join(
                        directory,
                        `database.worker-${databaseOrdinal}.heapsnapshot`
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

async function writeValidArtifacts(
    directory: string,
    databaseOrdinal = 4
): Promise<void> {
    await Promise.all([
        writeFile(
            join(directory, 'main.cpuprofile'),
            JSON.stringify(CPU_PROFILE)
        ),
        writeFile(
            join(directory, 'renderer.cpuprofile'),
            JSON.stringify(CPU_PROFILE)
        ),
        writeFile(
            join(directory, `database.worker-${databaseOrdinal}.cpuprofile`),
            JSON.stringify(CPU_PROFILE)
        ),
        writeFile(
            join(directory, `database.worker-${databaseOrdinal}.heapsnapshot`),
            JSON.stringify(HEAP_SNAPSHOT)
        ),
        writeFile(
            join(directory, 'main.heapsnapshot'),
            JSON.stringify(HEAP_SNAPSHOT)
        ),
        writeFile(
            join(directory, 'renderer.heapsnapshot'),
            JSON.stringify(HEAP_SNAPSHOT)
        ),
        writeFile(
            join(directory, 'renderer.trace.json'),
            JSON.stringify(RENDERER_TRACE)
        ),
    ]);
}

test('accepts the complete parseable initial-import diagnostic artifact set', async () => {
    const module = await diagnosticArtifactsModulePromise;
    assert.ok(module, 'initial-import diagnostic validator must exist');
    const validate = module.validateInitialImportDiagnosticArtifacts;
    assert.equal(typeof validate, 'function');
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-diagnostic-')
    );

    try {
        await writeValidArtifacts(directory);
        await assert.doesNotReject(() =>
            validate?.(capture(directory), directory)
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

test('fails closed for malformed or missing required process artifacts', async () => {
    const module = await diagnosticArtifactsModulePromise;
    assert.ok(module);
    const validate = module.validateInitialImportDiagnosticArtifacts;
    assert.equal(typeof validate, 'function');
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-invalid-')
    );

    try {
        await writeValidArtifacts(directory);
        await writeFile(join(directory, 'renderer.trace.json'), '{');
        await assert.rejects(
            () => validate?.(capture(directory), directory),
            /initial-import-diagnostic-artifact-invalid:renderer-trace/
        );

        await writeFile(
            join(directory, 'renderer.trace.json'),
            JSON.stringify(RENDERER_TRACE)
        );
        const missingMainProfile: DiagnosticCapture = {
            ...capture(directory),
            main: {
                ...capture(directory).main,
                cpuProfilePath: null,
            },
        };
        await assert.rejects(
            () => validate?.(missingMainProfile, directory),
            /initial-import-diagnostic-artifact-missing:main-cpu-profile/
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

test('rejects escaped paths and symlinks instead of reading outside the iteration directory', async () => {
    const module = await diagnosticArtifactsModulePromise;
    assert.ok(module);
    const validate = module.validateInitialImportDiagnosticArtifacts;
    assert.equal(typeof validate, 'function');
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-contained-')
    );
    const outsideDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-outside-')
    );

    try {
        await writeValidArtifacts(directory);
        const escapedCapture: DiagnosticCapture = {
            ...capture(directory),
            main: {
                ...capture(directory).main,
                cpuProfilePath: join(outsideDirectory, 'main.cpuprofile'),
            },
        };
        await writeFile(
            join(outsideDirectory, 'main.cpuprofile'),
            JSON.stringify(CPU_PROFILE)
        );
        await assert.rejects(
            () => validate?.(escapedCapture, directory),
            /initial-import-diagnostic-artifact-path-invalid:main-cpu-profile/
        );

        const rendererProfilePath = join(directory, 'renderer.cpuprofile');
        await unlink(rendererProfilePath);
        await symlink(
            join(outsideDirectory, 'main.cpuprofile'),
            rendererProfilePath
        );
        await assert.rejects(
            () => validate?.(capture(directory), directory),
            /initial-import-diagnostic-artifact-path-invalid:renderer-cpu-profile/
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
        await rm(outsideDirectory, { force: true, recursive: true });
    }
});

test('requires exactly one database profile and rejects every playlist-worker profile', async () => {
    const module = await diagnosticArtifactsModulePromise;
    assert.ok(module);
    const validate = module.validateInitialImportDiagnosticArtifacts;
    assert.equal(typeof validate, 'function');
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-workers-')
    );

    try {
        await writeValidArtifacts(directory);
        await writeFile(
            join(directory, 'database.worker-9.cpuprofile'),
            JSON.stringify(CPU_PROFILE)
        );
        await assert.rejects(
            () => validate?.(capture(directory), directory),
            /initial-import-diagnostic-database-profile-cardinality-invalid/
        );

        await unlink(join(directory, 'database.worker-9.cpuprofile'));
        await writeFile(
            join(directory, 'playlist-refresh.worker-2.cpuprofile'),
            JSON.stringify(CPU_PROFILE)
        );
        await assert.rejects(
            () => validate?.(capture(directory), directory),
            /initial-import-diagnostic-playlist-profile-unexpected/
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

test('requires a structurally valid database worker heap snapshot', async () => {
    const module = await diagnosticArtifactsModulePromise;
    assert.ok(module);
    const validate = module.validateInitialImportDiagnosticArtifacts;
    assert.equal(typeof validate, 'function');
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-worker-snapshot-')
    );

    try {
        await writeValidArtifacts(directory);
        const missingSnapshot: DiagnosticCapture = {
            ...capture(directory),
            main: {
                ...capture(directory).main,
                workers: [
                    {
                        ...capture(directory).main.workers[0],
                        snapshotPath: null,
                    },
                ],
            },
        };
        await assert.rejects(
            () => validate?.(missingSnapshot, directory),
            /initial-import-diagnostic-artifact-missing:database-heap-snapshot/
        );

        await writeFile(
            join(directory, 'database.worker-4.heapsnapshot'),
            JSON.stringify({ snapshot: {}, nodes: [], edges: [] })
        );
        await assert.rejects(
            () => validate?.(capture(directory), directory),
            /initial-import-diagnostic-artifact-invalid:database-heap-snapshot/
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

test('rejects escaped and symlinked database worker heap snapshots', async () => {
    const module = await diagnosticArtifactsModulePromise;
    assert.ok(module);
    const validate = module.validateInitialImportDiagnosticArtifacts;
    assert.equal(typeof validate, 'function');
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-worker-contained-')
    );
    const outsideDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-worker-outside-')
    );

    try {
        await writeValidArtifacts(directory);
        const outsideSnapshotPath = join(
            outsideDirectory,
            'database.worker-4.heapsnapshot'
        );
        await writeFile(outsideSnapshotPath, JSON.stringify(HEAP_SNAPSHOT));
        const escapedSnapshot: DiagnosticCapture = {
            ...capture(directory),
            main: {
                ...capture(directory).main,
                workers: [
                    {
                        ...capture(directory).main.workers[0],
                        snapshotPath: outsideSnapshotPath,
                    },
                ],
            },
        };
        await assert.rejects(
            () => validate?.(escapedSnapshot, directory),
            /initial-import-diagnostic-artifact-path-invalid:database-heap-snapshot/
        );

        const snapshotPath = join(directory, 'database.worker-4.heapsnapshot');
        await unlink(snapshotPath);
        await symlink(outsideSnapshotPath, snapshotPath);
        await assert.rejects(
            () => validate?.(capture(directory), directory),
            /initial-import-diagnostic-artifact-path-invalid:database-heap-snapshot/
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
        await rm(outsideDirectory, { force: true, recursive: true });
    }
});

test('rejects extra database snapshots and every playlist-worker snapshot', async () => {
    const module = await diagnosticArtifactsModulePromise;
    assert.ok(module);
    const validate = module.validateInitialImportDiagnosticArtifacts;
    assert.equal(typeof validate, 'function');
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-initial-import-worker-snapshot-count-')
    );

    try {
        await writeValidArtifacts(directory);
        await writeFile(
            join(directory, 'database.worker-9.heapsnapshot'),
            JSON.stringify(HEAP_SNAPSHOT)
        );
        await assert.rejects(
            () => validate?.(capture(directory), directory),
            /initial-import-diagnostic-database-snapshot-cardinality-invalid/
        );

        await unlink(join(directory, 'database.worker-9.heapsnapshot'));
        await writeFile(
            join(directory, 'playlist-refresh.worker-2.heapsnapshot'),
            JSON.stringify(HEAP_SNAPSHOT)
        );
        await assert.rejects(
            () => validate?.(capture(directory), directory),
            /initial-import-diagnostic-playlist-snapshot-unexpected/
        );
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});
