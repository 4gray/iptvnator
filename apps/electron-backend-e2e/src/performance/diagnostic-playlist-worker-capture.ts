import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { MainCaptureMetrics } from './m3u-refresh-cancellation-contract';

interface CpuProfile {
    readonly nodes?: unknown;
    readonly samples?: unknown;
}

export async function validateDiagnosticPlaylistWorkerCapture(
    main: MainCaptureMetrics,
    iterationDirectory: string
): Promise<void> {
    if (
        main.timeline.some((record) =>
            record.type.startsWith('worker-artifact-error:')
        )
    ) {
        throw new Error('diagnostic-playlist-worker-artifact-error');
    }

    const workers = main.workers.filter(
        (worker) => worker.kind === 'playlist-refresh.worker'
    );
    if (workers.length !== 1) {
        throw new Error('diagnostic-playlist-worker-cardinality-invalid');
    }
    const worker = workers[0];
    if (!worker) {
        throw new Error('diagnostic-playlist-worker-cardinality-invalid');
    }
    if (worker.snapshotPath !== null) {
        throw new Error('diagnostic-playlist-worker-snapshot-unexpected');
    }
    if (
        worker.postGcHeapUsedBytes !== null ||
        worker.postGcHeapUnavailableReason !==
            'worker-force-terminated-before-gc' ||
        worker.terminatedEpochMs === null
    ) {
        throw new Error('diagnostic-playlist-worker-termination-invalid');
    }
    if (worker.profilePath === null) {
        throw new Error('diagnostic-playlist-worker-profile-missing');
    }

    const expectedProfilePath = join(
        resolve(iterationDirectory),
        `playlist-refresh.worker-${worker.ordinal}.cpuprofile`
    );
    if (resolve(worker.profilePath) !== expectedProfilePath) {
        throw new Error('diagnostic-playlist-worker-profile-path-invalid');
    }

    let profile: CpuProfile;
    try {
        profile = JSON.parse(
            await readFile(expectedProfilePath, 'utf8')
        ) as CpuProfile;
    } catch {
        throw new Error('diagnostic-playlist-worker-profile-invalid');
    }
    if (
        !Array.isArray(profile.nodes) ||
        profile.nodes.length === 0 ||
        !Array.isArray(profile.samples) ||
        profile.samples.length === 0
    ) {
        throw new Error('diagnostic-playlist-worker-profile-invalid');
    }
}
