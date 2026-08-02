import {
    type DownloadMetadataSnapshot,
    type ElectronBridgeDownloadStatus,
    type ElectronDownloadFileAvailability,
} from '@iptvnator/shared/interfaces';
import { lstatSync, type Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { decodeDownloadMetadataSnapshot } from './download-metadata-snapshot';

interface DownloadFileRow {
    filePath?: string | null;
    metadataSnapshot?: string | null;
    status: ElectronBridgeDownloadStatus;
}

export type DownloadLstat = (
    filePath: string
) => Pick<Stats, 'isFile' | 'isSymbolicLink'>;

type DownloadAsyncLstat = (
    filePath: string
) => Promise<Pick<Stats, 'isFile' | 'isSymbolicLink'>>;

type DownloadFileAvailabilityProbeResult = boolean | 'unknown';

type DownloadFileAvailabilityProbe = (
    filePath: string
) => Promise<DownloadFileAvailabilityProbeResult>;

const DEFAULT_MAX_CONCURRENT_FILE_PROBES = 4;
const DEFAULT_FILE_PROBE_TIMEOUT_MS = 1_000;

export type BoundedDownloadFileAvailability =
    ElectronDownloadFileAvailability | 'unknown';

function isMissingFileSystemError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return false;
    }
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

export function createDownloadFileAvailabilityProbe(
    asyncLstat: DownloadAsyncLstat = lstat,
    maxConcurrent = DEFAULT_MAX_CONCURRENT_FILE_PROBES
): DownloadFileAvailabilityProbe {
    const concurrency = Math.max(1, Math.floor(maxConcurrent));
    const pending: Array<() => void> = [];
    // Coalesce unfinished probes, including work waiting for a slot. Caller
    // deadlines never evict this raw operation, so a stalled lstat remains
    // charged to the concurrency cap instead of being duplicated by refreshes.
    // Completed results are discarded so later filesystem changes stay visible.
    const inFlight = new Map<
        string,
        Promise<DownloadFileAvailabilityProbeResult>
    >();
    let active = 0;

    const acquire = (): Promise<void> => {
        if (active < concurrency) {
            active += 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => pending.push(resolve));
    };

    const release = (): void => {
        const next = pending.shift();
        if (next) {
            next();
        } else {
            active -= 1;
        }
    };

    const inspect = async (
        filePath: string
    ): Promise<DownloadFileAvailabilityProbeResult> => {
        await acquire();
        try {
            const stats = await asyncLstat(filePath);
            return stats.isFile() && !stats.isSymbolicLink();
        } catch (error) {
            return isMissingFileSystemError(error) ? false : 'unknown';
        } finally {
            release();
        }
    };

    return (filePath: string) => {
        const existing = inFlight.get(filePath);
        if (existing) {
            return existing;
        }

        const probe = inspect(filePath);
        inFlight.set(filePath, probe);
        const clear = () => {
            if (inFlight.get(filePath) === probe) {
                inFlight.delete(filePath);
            }
        };
        void probe.then(clear, clear);
        return probe;
    };
}

const probeDownloadFileAvailability = createDownloadFileAvailabilityProbe();

function toBoundedDownloadFileAvailability(
    available: DownloadFileAvailabilityProbeResult
): BoundedDownloadFileAvailability {
    if (available === 'unknown') {
        return available;
    }
    return available ? 'available' : 'missing';
}

async function probeDownloadFileAvailabilityWithTimeout(
    filePath: string,
    timeoutMs: number,
    probe: DownloadFileAvailabilityProbe
): Promise<DownloadFileAvailabilityProbeResult> {
    const boundedTimeoutMs =
        Number.isFinite(timeoutMs) && timeoutMs >= 0
            ? timeoutMs
            : DEFAULT_FILE_PROBE_TIMEOUT_MS;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'unknown'>((resolve) => {
        timeout = setTimeout(() => resolve('unknown'), boundedTimeoutMs);
    });

    try {
        return await Promise.race([probe(filePath), timedOut]);
    } catch {
        return 'unknown';
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}

export function isAvailableDownloadFile(
    filePath: string | null | undefined,
    lstat: DownloadLstat = lstatSync
): boolean {
    if (!filePath) {
        return false;
    }

    try {
        const stats = lstat(filePath);
        return stats.isFile() && !stats.isSymbolicLink();
    } catch {
        return false;
    }
}

export function getDownloadFileAvailability(
    download: DownloadFileRow,
    lstat: DownloadLstat = lstatSync
): ElectronDownloadFileAvailability {
    if (download.status !== 'completed') {
        return 'not-applicable';
    }

    return isAvailableDownloadFile(download.filePath, lstat)
        ? 'available'
        : 'missing';
}

export async function getDownloadFileAvailabilityAsync(
    download: DownloadFileRow,
    probe: DownloadFileAvailabilityProbe = probeDownloadFileAvailability
): Promise<ElectronDownloadFileAvailability> {
    if (download.status !== 'completed') {
        return 'not-applicable';
    }

    if (!download.filePath) {
        return 'missing';
    }

    const available = await probeDownloadFileAvailabilityWithTimeout(
        download.filePath,
        DEFAULT_FILE_PROBE_TIMEOUT_MS,
        probe
    );
    return available === true ? 'available' : 'missing';
}

export async function getDownloadFileAvailabilityWithTimeoutAsync(
    download: DownloadFileRow,
    timeoutMs = DEFAULT_FILE_PROBE_TIMEOUT_MS,
    probe: DownloadFileAvailabilityProbe = probeDownloadFileAvailability
): Promise<BoundedDownloadFileAvailability> {
    if (download.status !== 'completed') {
        return 'not-applicable';
    }

    if (!download.filePath) {
        return 'missing';
    }

    return toBoundedDownloadFileAvailability(
        await probeDownloadFileAvailabilityWithTimeout(
            download.filePath,
            timeoutMs,
            probe
        )
    );
}

export function decorateDownloadItem<T extends DownloadFileRow>(
    download: T,
    lstat: DownloadLstat = lstatSync
): Omit<T, 'metadataSnapshot'> & {
    metadataSnapshot: DownloadMetadataSnapshot | undefined;
    fileAvailability: ElectronDownloadFileAvailability;
} {
    return {
        ...download,
        metadataSnapshot: decodeDownloadMetadataSnapshot(
            download.metadataSnapshot
        ),
        fileAvailability: getDownloadFileAvailability(download, lstat),
    };
}

export async function decorateDownloadItemAsync<T extends DownloadFileRow>(
    download: T,
    probe: DownloadFileAvailabilityProbe = probeDownloadFileAvailability
): Promise<
    Omit<T, 'metadataSnapshot'> & {
        metadataSnapshot: DownloadMetadataSnapshot | undefined;
        fileAvailability: ElectronDownloadFileAvailability;
    }
> {
    return {
        ...download,
        metadataSnapshot: decodeDownloadMetadataSnapshot(
            download.metadataSnapshot
        ),
        fileAvailability: await getDownloadFileAvailabilityAsync(
            download,
            probe
        ),
    };
}
