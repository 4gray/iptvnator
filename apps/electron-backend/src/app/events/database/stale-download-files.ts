import { removePartialDownload } from './download-file-path';

interface StaleDownloadFile {
    filePath: string | null;
}

function removePersistedPartial(filePath: string): void {
    removePartialDownload({ getSavePath: () => filePath });
}

export function cleanupStaleDownloadFiles(
    downloads: readonly StaleDownloadFile[],
    removeFile: (filePath: string) => void = removePersistedPartial
): void {
    for (const download of downloads) {
        if (!download.filePath) {
            continue;
        }
        try {
            removeFile(download.filePath);
        } catch (error) {
            console.error(
                '[Downloads] Failed to delete stale partial file:',
                download.filePath,
                error
            );
        }
    }
}
