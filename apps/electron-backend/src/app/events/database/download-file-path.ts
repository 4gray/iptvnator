import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';

export interface ReservedDownloadFile {
    filename: string;
    path: string;
}

function createExclusiveFile(filePath: string): void {
    const descriptor = openSync(filePath, 'wx');
    closeSync(descriptor);
}

export function reserveAvailableDownloadFile(
    directory: string,
    requestedFilename: string,
    reserveFile: (filePath: string) => void = createExclusiveFile
): ReservedDownloadFile {
    const extension = extname(requestedFilename);
    const stem = extension
        ? requestedFilename.slice(0, -extension.length)
        : requestedFilename;
    let candidate = requestedFilename;
    let suffix = 1;

    for (;;) {
        const filePath = join(directory, candidate);
        try {
            reserveFile(filePath);
            return { filename: candidate, path: filePath };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }
            candidate = `${stem} (${suffix})${extension}`;
            suffix += 1;
        }
    }
}

export interface DownloadSavePathItem {
    getSavePath(): string;
}

export function removePartialDownload(
    downloadItem: DownloadSavePathItem | undefined,
    pathExists: (filePath: string) => boolean = existsSync,
    removeFile: (filePath: string) => void = unlinkSync
): boolean {
    const savePath = downloadItem?.getSavePath();
    if (!savePath || !pathExists(savePath)) {
        return false;
    }

    removeFile(savePath);
    return true;
}
