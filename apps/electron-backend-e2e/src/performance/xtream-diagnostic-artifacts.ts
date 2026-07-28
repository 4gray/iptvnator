import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
    isCpuProfile,
    isHeapSnapshot,
    isRendererTrace,
    readCpuProfileDurationMicros,
} from './initial-import-diagnostic-artifact-content-validation';
import {
    assertXtreamManifest,
    assertXtreamManifestIdentity,
} from './xtream-control-state-schema';
import {
    snapshotXtreamDiagnosticCapture,
    type XtreamDiagnosticCapture,
    type XtreamDiagnosticWorkerArtifact,
} from './xtream-diagnostic-capture-schema';
import {
    assertXtreamArtifactRedacted,
    createXtreamDiagnosticEvidenceAuthority,
    serializeXtreamArtifactForPersistence,
    type XtreamDiagnosticArtifactEvidence,
    type XtreamValidatedArtifactContent,
} from './xtream-diagnostic-evidence';
import {
    isXtreamUnsafeFileError,
    readXtreamSafeRegularFile,
} from './xtream-safe-file-read';

export {
    assertXtreamArtifactRedacted,
    assertXtreamManifest,
    assertXtreamManifestIdentity,
    serializeXtreamArtifactForPersistence,
};
export type {
    XtreamDiagnosticArtifactEvidence,
    XtreamDiagnosticArtifactReceipt,
} from './xtream-diagnostic-evidence';
export type { XtreamDiagnosticCapture } from './xtream-diagnostic-capture-schema';

interface ArtifactDescription {
    readonly capturesCpuProfileDuration: boolean;
    readonly filename: string;
    readonly label: string;
    readonly path: string | null;
    readonly validate: (value: unknown) => boolean;
}

const EVIDENCE_AUTHORITY = createXtreamDiagnosticEvidenceAuthority();

export async function validateXtreamDiagnosticArtifacts(
    capture: XtreamDiagnosticCapture,
    iterationDirectory: string
): Promise<XtreamDiagnosticArtifactEvidence> {
    const snapshot = snapshotXtreamDiagnosticCapture(capture);
    if (typeof iterationDirectory !== 'string') {
        throw artifactPathError('iteration-directory');
    }
    const directory = resolve(iterationDirectory);
    let realDirectory: string;
    try {
        const stats = await lstat(directory);
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
            throw new Error('unsafe-iteration-directory');
        }
        realDirectory = await realpath(directory);
    } catch {
        throw artifactPathError('iteration-directory');
    }

    const databaseWorker = requireExactDatabaseWorker(snapshot.main.workers);
    const artifacts: readonly ArtifactDescription[] = [
        artifact(
            'main.cpuprofile',
            'main-cpu-profile',
            snapshot.main.cpuProfilePath,
            isCpuProfile,
            true
        ),
        artifact(
            'renderer.cpuprofile',
            'renderer-cpu-profile',
            snapshot.renderer.cpuProfilePath,
            isCpuProfile,
            true
        ),
        artifact(
            'renderer.trace.json',
            'renderer-trace',
            snapshot.renderer.tracePath,
            isRendererTrace
        ),
        artifact(
            'main.heapsnapshot',
            'main-heap-snapshot',
            snapshot.main.heapSnapshotPath,
            isHeapSnapshot
        ),
        artifact(
            'renderer.heapsnapshot',
            'renderer-heap-snapshot',
            snapshot.renderer.heapSnapshotPath,
            isHeapSnapshot
        ),
        artifact(
            `database.worker-${databaseWorker.ordinal}.cpuprofile`,
            'database-cpu-profile',
            databaseWorker.profilePath,
            isCpuProfile,
            true
        ),
        artifact(
            `database.worker-${databaseWorker.ordinal}.heapsnapshot`,
            'database-heap-snapshot',
            databaseWorker.snapshotPath,
            isHeapSnapshot
        ),
    ];
    await assertWorkerArtifactCardinality(
        directory,
        artifacts.map(({ filename }) => filename)
    );
    const validated: XtreamValidatedArtifactContent[] = [];
    for (const description of artifacts) {
        validated.push(
            await validateJsonArtifact(directory, realDirectory, description)
        );
    }
    await assertWorkerArtifactCardinality(
        directory,
        artifacts.map(({ filename }) => filename)
    );
    return EVIDENCE_AUTHORITY.issue(
        realDirectory,
        validated,
        databaseWorker.ordinal
    );
}

export function assertXtreamDiagnosticArtifactEvidence(
    value: unknown
): asserts value is XtreamDiagnosticArtifactEvidence {
    if (!EVIDENCE_AUTHORITY.is(value)) {
        throw new Error(
            'expected validated Xtream diagnostic artifact evidence'
        );
    }
}

function requireExactDatabaseWorker(
    workers: readonly XtreamDiagnosticWorkerArtifact[]
): XtreamDiagnosticWorkerArtifact {
    if (workers.some((worker) => worker.kind === 'playlist-refresh.worker')) {
        throw new Error('xtream-diagnostic-playlist-profile-unexpected');
    }
    const databaseWorkers = workers.filter(
        (worker) => worker.kind === 'database.worker'
    );
    const worker = databaseWorkers[0];
    if (
        databaseWorkers.length !== 1 ||
        workers.length !== 1 ||
        !worker ||
        !Number.isSafeInteger(worker.ordinal) ||
        worker.ordinal <= 0
    ) {
        throw new Error(
            'xtream-diagnostic-database-profile-cardinality-invalid'
        );
    }
    return worker;
}

async function assertWorkerArtifactCardinality(
    directory: string,
    expectedArtifacts: readonly string[]
): Promise<void> {
    const entries = await listDiagnosticArtifactEntries(directory);
    if (
        entries.some((entry) =>
            /^playlist-refresh\.worker-\d+\.(?:cpuprofile|heapsnapshot)$/iu.test(
                entry
            )
        )
    ) {
        throw new Error('xtream-diagnostic-playlist-profile-unexpected');
    }
    for (const extension of ['cpuprofile', 'heapsnapshot']) {
        if (
            entries.filter((entry) =>
                new RegExp(
                    `^database\\.worker-\\d+\\.${extension}$`,
                    'iu'
                ).test(entry)
            ).length !== 1
        ) {
            throw new Error(
                `xtream-diagnostic-database-${extension === 'cpuprofile' ? 'profile' : 'snapshot'}-cardinality-invalid`
            );
        }
    }
    if (
        entries.length !== expectedArtifacts.length ||
        entries.some((entry) => !expectedArtifacts.includes(entry)) ||
        expectedArtifacts.some((entry) => !entries.includes(entry))
    ) {
        throw new Error('xtream-diagnostic-artifact-cardinality-invalid');
    }
}

async function listDiagnosticArtifactEntries(
    directory: string
): Promise<readonly string[]> {
    const artifacts: string[] = [];
    const walk = async (current: string): Promise<void> => {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const path = join(current, entry.name);
            if (
                /(?:\.cpuprofile|\.heapsnapshot|\.trace\.json)$/iu.test(
                    entry.name
                )
            ) {
                artifacts.push(relative(directory, path));
            }
            if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
            const stats = await lstat(path);
            if (stats.isSymbolicLink()) continue;
            if (!stats.isDirectory()) {
                throw new Error('unsafe-artifact-tree-entry');
            }
            await walk(path);
        }
    };
    try {
        await walk(directory);
        return artifacts;
    } catch {
        throw artifactPathError('iteration-directory');
    }
}

async function validateJsonArtifact(
    directory: string,
    realDirectory: string,
    description: ArtifactDescription
): Promise<XtreamValidatedArtifactContent> {
    if (description.path === null) {
        throw new Error(
            `xtream-diagnostic-artifact-missing:${description.label}`
        );
    }
    const expectedPath = join(directory, description.filename);
    if (resolve(description.path) !== expectedPath) {
        throw artifactPathError(description.label);
    }

    let content: Buffer;
    let value: unknown;
    try {
        const snapshot = await readXtreamSafeRegularFile(expectedPath);
        const realArtifactPath = snapshot.realPath;
        if (!isContained(realDirectory, realArtifactPath)) {
            throw new Error('escaped-artifact');
        }
        content = snapshot.content;
        value = JSON.parse(content.toString('utf8')) as unknown;
    } catch (error) {
        if (
            isXtreamUnsafeFileError(error) ||
            (error instanceof Error && error.message === 'escaped-artifact')
        ) {
            throw artifactPathError(description.label);
        }
        throw new Error(
            `xtream-diagnostic-artifact-invalid:${description.label}`
        );
    }
    if (!description.validate(value)) {
        throw new Error(
            `xtream-diagnostic-artifact-invalid:${description.label}`
        );
    }
    return {
        content,
        cpuProfileDurationMicros: description.capturesCpuProfileDuration
            ? readCpuProfileDurationMicros(value)
            : null,
        filename: description.filename,
        label: description.label,
    };
}

function artifact(
    filename: string,
    label: string,
    path: string | null,
    validate: (value: unknown) => boolean,
    capturesCpuProfileDuration = false
): ArtifactDescription {
    return {
        capturesCpuProfileDuration,
        filename,
        label,
        path,
        validate,
    };
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

function artifactPathError(label: string): Error {
    return new Error(`xtream-diagnostic-artifact-path-invalid:${label}`);
}
