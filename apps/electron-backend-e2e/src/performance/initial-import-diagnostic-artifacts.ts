import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
    isCpuProfile,
    isHeapSnapshot,
    isRendererTrace,
} from './initial-import-diagnostic-artifact-content-validation';

interface DiagnosticWorkerArtifact {
    readonly kind: string;
    readonly ordinal: number;
    readonly profilePath: string | null;
    readonly snapshotPath: string | null;
}

export interface InitialImportDiagnosticCapture {
    readonly main: {
        readonly cpuProfilePath: string | null;
        readonly heapSnapshotPath: string | null;
        readonly workers: readonly DiagnosticWorkerArtifact[];
    };
    readonly renderer: {
        readonly cpuProfilePath: string | null;
        readonly heapSnapshotPath: string | null;
        readonly tracePath: string | null;
    };
}

type ArtifactLabel =
    | 'database-cpu-profile'
    | 'database-heap-snapshot'
    | 'main-cpu-profile'
    | 'main-heap-snapshot'
    | 'renderer-cpu-profile'
    | 'renderer-heap-snapshot'
    | 'renderer-trace';

interface ArtifactDescription {
    readonly filename: string;
    readonly label: ArtifactLabel;
    readonly path: string | null;
    readonly validate: (value: unknown) => boolean;
}

export async function validateInitialImportDiagnosticArtifacts(
    capture: InitialImportDiagnosticCapture,
    iterationDirectory: string
): Promise<void> {
    const directory = resolve(iterationDirectory);
    let realDirectory: string;
    try {
        realDirectory = await realpath(directory);
    } catch {
        throw new Error(
            'initial-import-diagnostic-artifact-path-invalid:iteration-directory'
        );
    }

    const databaseWorker = requireExactDatabaseWorker(capture.main.workers);
    await assertWorkerArtifactCardinality(directory);

    const artifacts: readonly ArtifactDescription[] = [
        {
            filename: 'main.cpuprofile',
            label: 'main-cpu-profile',
            path: capture.main.cpuProfilePath,
            validate: isCpuProfile,
        },
        {
            filename: 'renderer.cpuprofile',
            label: 'renderer-cpu-profile',
            path: capture.renderer.cpuProfilePath,
            validate: isCpuProfile,
        },
        {
            filename: 'renderer.trace.json',
            label: 'renderer-trace',
            path: capture.renderer.tracePath,
            validate: isRendererTrace,
        },
        {
            filename: 'main.heapsnapshot',
            label: 'main-heap-snapshot',
            path: capture.main.heapSnapshotPath,
            validate: isHeapSnapshot,
        },
        {
            filename: 'renderer.heapsnapshot',
            label: 'renderer-heap-snapshot',
            path: capture.renderer.heapSnapshotPath,
            validate: isHeapSnapshot,
        },
        {
            filename: `database.worker-${databaseWorker.ordinal}.cpuprofile`,
            label: 'database-cpu-profile',
            path: databaseWorker.profilePath,
            validate: isCpuProfile,
        },
        {
            filename: `database.worker-${databaseWorker.ordinal}.heapsnapshot`,
            label: 'database-heap-snapshot',
            path: databaseWorker.snapshotPath,
            validate: isHeapSnapshot,
        },
    ];

    for (const artifact of artifacts) {
        await validateJsonArtifact(directory, realDirectory, artifact);
    }
}

function requireExactDatabaseWorker(
    workers: readonly DiagnosticWorkerArtifact[]
): DiagnosticWorkerArtifact {
    if (
        workers.some(
            (worker) =>
                worker.kind === 'playlist-refresh.worker' &&
                worker.profilePath !== null
        )
    ) {
        throw new Error(
            'initial-import-diagnostic-playlist-profile-unexpected'
        );
    }
    if (
        workers.some(
            (worker) =>
                worker.kind === 'playlist-refresh.worker' &&
                worker.snapshotPath !== null
        )
    ) {
        throw new Error(
            'initial-import-diagnostic-playlist-snapshot-unexpected'
        );
    }
    const databaseWorkers = workers.filter(
        (worker) => worker.kind === 'database.worker'
    );
    const worker = databaseWorkers[0];
    if (
        databaseWorkers.length !== 1 ||
        !worker ||
        !Number.isSafeInteger(worker.ordinal) ||
        worker.ordinal < 0
    ) {
        throw new Error(
            'initial-import-diagnostic-database-profile-cardinality-invalid'
        );
    }
    return worker;
}

async function assertWorkerArtifactCardinality(
    directory: string
): Promise<void> {
    let entries: readonly string[];
    try {
        entries = await readdir(directory);
    } catch {
        throw new Error(
            'initial-import-diagnostic-artifact-path-invalid:iteration-directory'
        );
    }
    if (
        entries.some((entry) =>
            /^playlist-refresh\.worker-\d+\.cpuprofile$/u.test(entry)
        )
    ) {
        throw new Error(
            'initial-import-diagnostic-playlist-profile-unexpected'
        );
    }
    if (
        entries.filter((entry) =>
            /^database\.worker-\d+\.cpuprofile$/u.test(entry)
        ).length !== 1
    ) {
        throw new Error(
            'initial-import-diagnostic-database-profile-cardinality-invalid'
        );
    }
    if (
        entries.some((entry) =>
            /^playlist-refresh\.worker-\d+\.heapsnapshot$/u.test(entry)
        )
    ) {
        throw new Error(
            'initial-import-diagnostic-playlist-snapshot-unexpected'
        );
    }
    if (
        entries.filter((entry) =>
            /^database\.worker-\d+\.heapsnapshot$/u.test(entry)
        ).length !== 1
    ) {
        throw new Error(
            'initial-import-diagnostic-database-snapshot-cardinality-invalid'
        );
    }
}

async function validateJsonArtifact(
    directory: string,
    realDirectory: string,
    artifact: ArtifactDescription
): Promise<void> {
    if (artifact.path === null) {
        throw new Error(
            `initial-import-diagnostic-artifact-missing:${artifact.label}`
        );
    }
    const expectedPath = join(directory, artifact.filename);
    if (resolve(artifact.path) !== expectedPath) {
        throw new Error(
            `initial-import-diagnostic-artifact-path-invalid:${artifact.label}`
        );
    }

    let value: unknown;
    try {
        const stats = await lstat(expectedPath);
        if (!stats.isFile() || stats.isSymbolicLink()) {
            throw new Error('unsafe-artifact-type');
        }
        const realArtifactPath = await realpath(expectedPath);
        if (!isContained(realDirectory, realArtifactPath)) {
            throw new Error('escaped-artifact');
        }
        value = JSON.parse(await readFile(realArtifactPath, 'utf8')) as unknown;
    } catch (error) {
        if (
            error instanceof Error &&
            (error.message === 'unsafe-artifact-type' ||
                error.message === 'escaped-artifact')
        ) {
            throw new Error(
                `initial-import-diagnostic-artifact-path-invalid:${artifact.label}`
            );
        }
        throw new Error(
            `initial-import-diagnostic-artifact-invalid:${artifact.label}`
        );
    }

    if (!artifact.validate(value)) {
        throw new Error(
            `initial-import-diagnostic-artifact-invalid:${artifact.label}`
        );
    }
}

function isContained(directory: string, artifactPath: string): boolean {
    const relativePath = relative(directory, artifactPath);
    return (
        relativePath.length > 0 &&
        !isAbsolute(relativePath) &&
        relativePath !== '..' &&
        !relativePath.startsWith(`..${sep}`)
    );
}
