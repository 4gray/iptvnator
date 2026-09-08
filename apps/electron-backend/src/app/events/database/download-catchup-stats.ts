import { lstatSync, type BigIntStats, type Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';

/** Preserve 64-bit file IDs; Number stats can round Windows file references. */
export function archiveFileStats(file: BigIntStats | Stats) {
    if (
        (typeof file.dev === 'number' && !Number.isSafeInteger(file.dev)) ||
        (typeof file.ino === 'number' && !Number.isSafeInteger(file.ino))
    )
        throw new Error('Archive filesystem identity was rounded');
    const birthtimeMs =
        'birthtimeNs' in file
            ? Number(file.birthtimeNs / BigInt(1000000000)) * 1000 +
              Number(file.birthtimeNs % BigInt(1000000000)) / 1000000
            : file.birthtimeMs;
    return {
        dev: String(file.dev),
        ino: String(file.ino),
        birthtimeMs,
        size: Number(file.size),
        nlink: Number(file.nlink),
        isFile: () => file.isFile(),
    };
}
export type ArchiveFileStats = ReturnType<typeof archiveFileStats>;
export async function readArchiveStats(path: string) {
    return archiveFileStats(await lstat(path, { bigint: true }));
}
export function readArchiveStatsSync(path: string) {
    return archiveFileStats(lstatSync(path, { bigint: true }));
}
