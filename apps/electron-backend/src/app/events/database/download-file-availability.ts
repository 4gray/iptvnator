import {
    type DownloadMetadataSnapshot,
    type ElectronBridgeDownloadStatus,
    type ElectronDownloadFileAvailability,
} from '@iptvnator/shared/interfaces';
import { lstatSync, type Stats } from 'node:fs';
import { decodeDownloadMetadataSnapshot } from './download-metadata-snapshot';

interface DownloadFileRow {
    filePath?: string | null;
    metadataSnapshot?: string | null;
    status: ElectronBridgeDownloadStatus;
}

export type DownloadLstat = (
    filePath: string
) => Pick<Stats, 'isFile' | 'isSymbolicLink'>;

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
