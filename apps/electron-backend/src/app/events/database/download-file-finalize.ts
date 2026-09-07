import { constants } from 'node:fs';
import { copyFile, link, stat, unlink } from 'node:fs/promises';
import type { ReservedPartialDownloadFile } from './download-file-path';

export async function finalizePartialDownload(
    reservation: ReservedPartialDownloadFile,
    expectedFileSize: number
): Promise<number> {
    try {
        await link(reservation.partialPath, reservation.path);
    } catch (error) {
        if (!canCopyCompletedPartialAfterLinkFailure(error)) {
            throw error;
        }
        await copyFile(
            reservation.partialPath,
            reservation.path,
            constants.COPYFILE_EXCL
        );
    }
    try {
        await unlink(reservation.partialPath);
    } catch (error) {
        const fileSize = await getExpectedFinalFileSize(
            reservation.path,
            expectedFileSize
        );
        if (fileSize !== null) {
            console.error(
                '[Downloads] Failed to delete completed partial file:',
                error
            );
            return fileSize;
        }
        throw error;
    }
    const fileStats = await stat(reservation.path);
    return fileStats.size;
}

async function getExpectedFinalFileSize(
    filePath: string,
    expectedFileSize: number
): Promise<number | null> {
    try {
        const fileStats = await stat(filePath);
        return fileStats.size === expectedFileSize ? fileStats.size : null;
    } catch {
        return null;
    }
}

function canCopyCompletedPartialAfterLinkFailure(error: unknown): boolean {
    const errorCode = (error as NodeJS.ErrnoException).code;
    return (
        errorCode === 'EACCES' ||
        errorCode === 'ENOSYS' ||
        errorCode === 'ENOTSUP' ||
        errorCode === 'EOPNOTSUPP' ||
        errorCode === 'EPERM' ||
        errorCode === 'EXDEV'
    );
}
