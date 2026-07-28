import assert from 'node:assert/strict';
import {
    mkdir,
    mkdtemp,
    rm,
    symlink,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { CPU_PROFILE } from './initial-import-diagnostic-test-fixtures';
import {
    assertXtreamDiagnosticArtifactEvidence,
    validateXtreamDiagnosticArtifacts,
    type XtreamDiagnosticCapture,
} from './xtream-diagnostic-artifacts';

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

describe('Xtream diagnostic artifacts', () => {
    it('accepts one complete main, renderer, and database-worker artifact set', async () => {
        const directory = await createDirectory('valid');
        await writeValidArtifacts(directory);

        const evidence = await validateXtreamDiagnosticArtifacts(
            capture(directory),
            directory
        );

        assertXtreamDiagnosticArtifactEvidence(evidence);
        assert.equal(evidence.artifacts.length, 7);
        assert.match(evidence.directorySha256, /^[a-f0-9]{64}$/u);
        assert.ok(
            evidence.artifacts.every(
                ({ bytes, filename, label, sha256 }) =>
                    bytes > 0 &&
                    filename.length > 0 &&
                    label.length > 0 &&
                    /^[a-f0-9]{64}$/u.test(sha256)
            )
        );
        assert.ok(Object.isFrozen(evidence));
        assert.ok(Object.isFrozen(evidence.artifacts));
        assert.ok(evidence.artifacts.every(Object.isFrozen));
        assert.throws(
            () =>
                assertXtreamDiagnosticArtifactEvidence(
                    structuredClone(evidence)
                ),
            /validated Xtream diagnostic artifact evidence/
        );
    });

    it('fails closed for malformed or missing process artifacts', async () => {
        const directory = await createDirectory('invalid');
        await writeValidArtifacts(directory);
        await writeFile(join(directory, 'renderer.trace.json'), '{');

        await assert.rejects(
            () =>
                validateXtreamDiagnosticArtifacts(
                    capture(directory),
                    directory
                ),
            /xtream-diagnostic-artifact-invalid:renderer-trace/
        );

        await writeFile(
            join(directory, 'renderer.trace.json'),
            JSON.stringify(RENDERER_TRACE)
        );
        const missing: XtreamDiagnosticCapture = {
            ...capture(directory),
            main: {
                ...capture(directory).main,
                cpuProfilePath: null,
            },
        };
        await assert.rejects(
            () => validateXtreamDiagnosticArtifacts(missing, directory),
            /xtream-diagnostic-artifact-missing:main-cpu-profile/
        );
    });

    it('rejects escaped paths and symlinks', async () => {
        const directory = await createDirectory('contained');
        const outside = await createDirectory('outside');
        await writeValidArtifacts(directory);
        await writeFile(
            join(outside, 'main.cpuprofile'),
            JSON.stringify(CPU_PROFILE)
        );

        const escaped: XtreamDiagnosticCapture = {
            ...capture(directory),
            main: {
                ...capture(directory).main,
                cpuProfilePath: join(outside, 'main.cpuprofile'),
            },
        };
        await assert.rejects(
            () => validateXtreamDiagnosticArtifacts(escaped, directory),
            /xtream-diagnostic-artifact-path-invalid:main-cpu-profile/
        );

        const rendererProfile = join(directory, 'renderer.cpuprofile');
        await unlink(rendererProfile);
        await symlink(join(outside, 'main.cpuprofile'), rendererProfile);
        await assert.rejects(
            () =>
                validateXtreamDiagnosticArtifacts(
                    capture(directory),
                    directory
                ),
            /xtream-diagnostic-artifact-path-invalid:renderer-cpu-profile/
        );

        const symlinkRoot = await createDirectory('directory-symlink');
        const realDirectory = join(symlinkRoot, 'real');
        const symlinkDirectory = join(symlinkRoot, 'alias');
        await mkdir(realDirectory);
        await writeValidArtifacts(realDirectory);
        await symlink(realDirectory, symlinkDirectory, 'dir');
        await assert.rejects(
            () =>
                validateXtreamDiagnosticArtifacts(
                    capture(symlinkDirectory),
                    symlinkDirectory
                ),
            /xtream-diagnostic-artifact-path-invalid:iteration-directory/
        );
    });

    it('requires exactly one database worker and no playlist-refresh worker', async () => {
        const directory = await createDirectory('workers');
        await writeValidArtifacts(directory);
        await writeFile(
            join(directory, 'database.worker-9.cpuprofile'),
            JSON.stringify(CPU_PROFILE)
        );

        await assert.rejects(
            () =>
                validateXtreamDiagnosticArtifacts(
                    capture(directory),
                    directory
                ),
            /xtream-diagnostic-database-profile-cardinality-invalid/
        );

        await unlink(join(directory, 'database.worker-9.cpuprofile'));
        await writeFile(
            join(directory, 'playlist-refresh.worker-2.cpuprofile'),
            JSON.stringify(CPU_PROFILE)
        );
        await assert.rejects(
            () =>
                validateXtreamDiagnosticArtifacts(
                    capture(directory),
                    directory
                ),
            /xtream-diagnostic-playlist-profile-unexpected/
        );
    });

    it('rejects every rogue top-level profile, snapshot, and trace artifact', async () => {
        const filenames = [
            'main-extra.cpuprofile',
            'main-extra.heapsnapshot',
            'renderer-extra.cpuprofile',
            'renderer-extra.heapsnapshot',
            'renderer-extra.trace.json',
            'rogue.cpuprofile',
            'rogue.heapsnapshot',
            'rogue.trace.json',
            'database.worker-evil.cpuprofile',
            'database.worker-4.trace.json',
            'playlist-refresh.worker-2.trace.json',
            'rogue.CPUPROFILE',
            'rogue.HeapSnapshot',
            'rogue.TRACE.JSON',
        ] as const;

        for (const filename of filenames) {
            const directory = await createDirectory(filename);
            await writeValidArtifacts(directory);
            await writeFile(
                join(directory, filename),
                JSON.stringify(
                    filename.endsWith('.cpuprofile')
                        ? CPU_PROFILE
                        : filename.endsWith('.heapsnapshot')
                          ? HEAP_SNAPSHOT
                          : RENDERER_TRACE
                )
            );

            await assert.rejects(
                () =>
                    validateXtreamDiagnosticArtifacts(
                        capture(directory),
                        directory
                    ),
                /xtream-diagnostic-artifact-cardinality-invalid/
            );
        }
    });

    it('rejects mixed-case rogue artifacts nested anywhere in the iteration tree', async () => {
        const directory = await createDirectory('nested-rogue');
        const nested = join(directory, 'nested');
        await writeValidArtifacts(directory);
        await mkdir(nested);
        await writeFile(
            join(nested, 'rogue.CpuProfile'),
            JSON.stringify(CPU_PROFILE)
        );

        await assert.rejects(
            () =>
                validateXtreamDiagnosticArtifacts(
                    capture(directory),
                    directory
                ),
            /^Error: xtream-diagnostic-artifact-cardinality-invalid$/
        );
    });

    it('snapshots the validated database worker ordinal before constructing paths', async () => {
        const directory = await createDirectory('ordinal-getter');
        await writeValidArtifacts(directory);
        let reads = 0;
        const worker = {
            kind: 'database.worker',
            get ordinal(): number {
                reads += 1;
                return reads === 1 ? 4 : ('../../outside' as unknown as number);
            },
            profilePath: join(directory, 'database.worker-4.cpuprofile'),
            snapshotPath: join(directory, 'database.worker-4.heapsnapshot'),
        };
        const getterCapture: XtreamDiagnosticCapture = {
            ...capture(directory),
            main: {
                ...capture(directory).main,
                workers: [worker],
            },
        };

        await assert.doesNotReject(() =>
            validateXtreamDiagnosticArtifacts(getterCapture, directory)
        );
        assert.equal(reads, 1);
    });

    it('sanitizes capture Proxy failures before filesystem access', async () => {
        const secret = 'must-not-escape-diagnostic-capture';
        const directory = await createDirectory('proxy-capture');
        const captureProxy = new Proxy(
            {},
            {
                ownKeys() {
                    throw new Error(secret);
                },
            }
        ) as XtreamDiagnosticCapture;

        await assert.rejects(
            () => validateXtreamDiagnosticArtifacts(captureProxy, directory),
            (error: unknown) =>
                error instanceof Error &&
                error.message === 'xtream-diagnostic-capture-invalid' &&
                !error.message.includes(secret)
        );
    });
});

function capture(
    directory: string,
    databaseOrdinal = 4
): XtreamDiagnosticCapture {
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

async function createDirectory(label: string): Promise<string> {
    const directory = await mkdtemp(
        join(tmpdir(), `iptvnator-xtream-diagnostic-${label}-`)
    );
    directories.push(directory);
    return directory;
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
