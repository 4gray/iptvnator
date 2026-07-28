export interface XtreamDiagnosticWorkerArtifact {
    readonly kind: string;
    readonly ordinal: number;
    readonly profilePath: string | null;
    readonly snapshotPath: string | null;
}

export interface XtreamDiagnosticCapture {
    readonly main: {
        readonly cpuProfilePath: string | null;
        readonly heapSnapshotPath: string | null;
        readonly workers: readonly XtreamDiagnosticWorkerArtifact[];
    };
    readonly renderer: {
        readonly cpuProfilePath: string | null;
        readonly heapSnapshotPath: string | null;
        readonly tracePath: string | null;
    };
}

export function snapshotXtreamDiagnosticCapture(
    value: unknown
): XtreamDiagnosticCapture {
    try {
        return snapshotCapture(value);
    } catch {
        throw new Error('xtream-diagnostic-capture-invalid');
    }
}

function snapshotCapture(value: unknown): XtreamDiagnosticCapture {
    if (!isExactRecord(value, ['main', 'renderer'])) invalid();
    const main = value['main'];
    const renderer = value['renderer'];
    const workerValues =
        typeof main === 'object' && main !== null
            ? Reflect.get(main, 'workers')
            : null;
    if (
        !isExactRecord(main, [
            'cpuProfilePath',
            'heapSnapshotPath',
            'workers',
        ]) ||
        !isExactRecord(renderer, [
            'cpuProfilePath',
            'heapSnapshotPath',
            'tracePath',
        ]) ||
        !Array.isArray(workerValues)
    ) {
        invalid();
    }
    const workers = snapshotWorkers(workerValues);
    const snapshot = {
        main: {
            cpuProfilePath: snapshotPath(main['cpuProfilePath']),
            heapSnapshotPath: snapshotPath(main['heapSnapshotPath']),
            workers: Object.freeze(workers),
        },
        renderer: {
            cpuProfilePath: snapshotPath(renderer['cpuProfilePath']),
            heapSnapshotPath: snapshotPath(renderer['heapSnapshotPath']),
            tracePath: snapshotPath(renderer['tracePath']),
        },
    };
    Object.freeze(snapshot.main);
    Object.freeze(snapshot.renderer);
    return Object.freeze(snapshot);
}

function snapshotWorkers(value: unknown): XtreamDiagnosticWorkerArtifact[] {
    if (!Array.isArray(value)) invalid();
    const length = Reflect.get(value, 'length') as unknown;
    if (
        !Number.isSafeInteger(length) ||
        Number(length) < 0 ||
        Number(length) > 64
    ) {
        invalid();
    }
    const expected = new Set([
        'length',
        ...Array.from({ length: Number(length) }, (_, index) => String(index)),
    ]);
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== expected.size ||
        keys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
        invalid();
    }
    return Array.from({ length: Number(length) }, (_, index) =>
        snapshotWorker(Reflect.get(value, String(index)))
    );
}

function snapshotWorker(value: unknown): XtreamDiagnosticWorkerArtifact {
    if (
        !isExactRecord(value, [
            'kind',
            'ordinal',
            'profilePath',
            'snapshotPath',
        ])
    ) {
        invalid();
    }
    const kind = value['kind'];
    const ordinal = value['ordinal'];
    const profilePath = snapshotPath(value['profilePath']);
    const snapshotPathValue = snapshotPath(value['snapshotPath']);
    if (
        typeof kind !== 'string' ||
        !Number.isSafeInteger(ordinal) ||
        Number(ordinal) <= 0
    ) {
        invalid();
    }
    return Object.freeze({
        kind,
        ordinal: ordinal as number,
        profilePath,
        snapshotPath: snapshotPathValue,
    });
}

function snapshotPath(value: unknown): string | null {
    if (value !== null && typeof value !== 'string') invalid();
    return value as string | null;
}

function isExactRecord(
    value: unknown,
    keys: readonly string[]
): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const actual = Reflect.ownKeys(value);
    return (
        actual.length === keys.length &&
        actual.every((key) => typeof key === 'string' && keys.includes(key))
    );
}

function invalid(): never {
    throw new Error('invalid diagnostic capture');
}
