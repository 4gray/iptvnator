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

type DownloadFileAvailabilityProbe = (
    filePath: string
) => Promise<boolean>;

const DEFAULT_MAX_CONCURRENT_FILE_PROBES = 4;

function createDownloadFileAvailabilityProbe(
    asyncLstat: DownloadAsyncLstat = lstat,
    maxConcurrent = DEFAULT_MAX_CONCURRENT_FILE_PROBES
): DownloadFileAvailabilityProbe {
    const concurrency = Math.max(1, Math.floor(maxConcurrent));
    const pending: Array<() => void> = [];
    // Coalesce only active probes. Completed results are discarded so an
    // externally removed file is visible on the next list refresh.
    const inFlight = new Map<string, Promise<boolean>>();
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

    const inspect = async (filePath: string): Promise<boolean> => {
        await acquire();
        try {
            const stats = await asyncLstat(filePath);
            return stats.isFile() && !stats.isSymbolicLink();
        } catch {
            return false;
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

    return (await probe(download.filePath)) ? 'available' : 'missing';
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
