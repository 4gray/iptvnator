import {
    closeSync,
    existsSync,
    lstatSync,
    openSync,
    unlinkSync,
} from 'node:fs';
import { extname, join } from 'node:path';

export interface ReservedDownloadFile {
    filename: string;
    path: string;
}

export interface ReservedPartialDownloadFile extends ReservedDownloadFile {
    partialPath: string;
}

function createExclusiveFile(filePath: string): void {
    const descriptor = openSync(filePath, 'wx');
    closeSync(descriptor);
}

function createExistsError(filePath: string): NodeJS.ErrnoException {
    const error = new Error(`File already exists: ${filePath}`) as NodeJS.ErrnoException;
    error.code = 'EEXIST';
    return error;
}

export function getPartialDownloadPath(filePath: string): string {
    return `${filePath}.part`;
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

export function reserveAvailablePartialDownloadFile(
    directory: string,
    requestedFilename: string,
    reserveFile: (filePath: string) => void = createExclusiveFile,
    pathExists: (filePath: string) => boolean = existsSync
): ReservedPartialDownloadFile {
    const extension = extname(requestedFilename);
    const stem = extension
        ? requestedFilename.slice(0, -extension.length)
        : requestedFilename;
    let candidate = requestedFilename;
    let suffix = 1;

    for (;;) {
        const filePath = join(directory, candidate);
        const partialPath = getPartialDownloadPath(filePath);
        try {
            if (pathExists(filePath)) {
                throw createExistsError(filePath);
            }
            reserveFile(partialPath);
            return { filename: candidate, partialPath, path: filePath };
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

export function removePartialDownloadFile(
    filePath: string | null | undefined,
    pathExists: (filePath: string) => boolean = existsSync,
    removeFile: (filePath: string) => void = unlinkSync
): boolean {
    if (!filePath) {
        return false;
    }

    const partialPath = getPartialDownloadPath(filePath);
    if (!pathExists(partialPath)) {
        return false;
    }

    removeFile(partialPath);
    return true;
}

function getRegularFileStats(filePath: string): { size: number } {
    // lstat + isFile so appending to a retained .part can never follow a
    // symlink planted in its place while the download was paused.
    const stats = lstatSync(filePath);
    if (!stats.isFile()) {
        throw new Error(`Partial download is not a regular file: ${filePath}`);
    }
    return stats;
}

export function getPartialDownloadSize(
    filePath: string | null | undefined,
    getStats: (filePath: string) => { size: number } = getRegularFileStats
): number {
    if (!filePath) {
        return 0;
    }

    try {
        return getStats(getPartialDownloadPath(filePath)).size;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
        return 0;
    }
}
