import { archiveFileStats, readArchiveStats } from './download-catchup-stats';
import { constants, type WriteStream } from 'node:fs';
import { open } from 'node:fs/promises';

export interface ArchiveFileIdentity {
    readonly dev: number | string;
    readonly ino: number | string;
    readonly birthtimeMs: number;
}

export function isArchiveFileId(value: unknown): value is number | string {
    return typeof value === 'string'
        ? /^(0|[1-9][0-9]{0,19})$/.test(value) &&
              BigInt(value) <= BigInt('18446744073709551615')
        : typeof value === 'number' &&
              Number.isSafeInteger(value) &&
              value >= 0;
}

/** Inodes can be reused after unlink; creation time identifies the generation. */
export function sameArchiveFileIdentity(
    a: ArchiveFileIdentity,
    b: ArchiveFileIdentity
): boolean {
    return (
        isArchiveFileId(a.dev) &&
        isArchiveFileId(a.ino) &&
        isArchiveFileId(b.dev) &&
        isArchiveFileId(b.ino) &&
        String(a.dev) === String(b.dev) &&
        String(a.ino) === String(b.ino) &&
        Number.isFinite(a.birthtimeMs) &&
        a.birthtimeMs > 0 &&
        a.birthtimeMs === b.birthtimeMs
    );
}

export function archiveFileIdentity(
    file: ArchiveFileIdentity
): ArchiveFileIdentity {
    if (!isArchiveFileId(file.dev) || !isArchiveFileId(file.ino))
        throw new Error('Archive filesystem identity is unavailable');
    if (!Number.isFinite(file.birthtimeMs) || file.birthtimeMs <= 0)
        throw new Error('Archive filesystem creation time is unavailable');
    return {
        dev: String(file.dev),
        ino: String(file.ino),
        birthtimeMs: file.birthtimeMs,
    };
}

export class ArchivePartialReplacedError extends Error {
    constructor() {
        super('Archive partial changed before opening');
    }
}

/** Open without truncation first: a replaced partial must not damage its target. */
export async function openCatchupOutput(
    partialPath: string,
    expectedIdentity?: ArchiveFileIdentity,
    beforeTruncate?: (identity: ArchiveFileIdentity) => Promise<void>
): Promise<{ stream: WriteStream; identity: ArchiveFileIdentity }> {
    const before = await readArchiveStats(partialPath).catch(
        (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
        }
    );
    if (before && (!before.isFile() || before.nlink !== 1)) {
        throw new ArchivePartialReplacedError();
    }
    const handle = await open(
        partialPath,
        constants.O_WRONLY |
            (constants.O_NOFOLLOW ?? 0) |
            (before ? 0 : constants.O_CREAT | constants.O_EXCL),
        0o600
    );
    try {
        const current = archiveFileStats(await handle.stat({ bigint: true }));
        const identity = archiveFileIdentity(current);
        // Descriptor identity also protects platforms without O_NOFOLLOW from
        // a link/file replacement between lstat and open. Missing files use wx.
        if (
            !current.isFile() ||
            current.nlink !== 1 ||
            (before && !sameArchiveFileIdentity(current, before)) ||
            (before &&
                (!expectedIdentity ||
                    !sameArchiveFileIdentity(current, expectedIdentity)))
        ) {
            throw new ArchivePartialReplacedError();
        }
        // Keep durable ownership evidence until the actual descriptor passes.
        await beforeTruncate?.(identity);
        await handle.truncate(0);
        // All writes use this verified descriptor; never reopen by pathname.
        return {
            stream: handle.createWriteStream({ autoClose: true }),
            identity,
        };
    } catch (error) {
        await handle.close();
        throw error;
    }
}
