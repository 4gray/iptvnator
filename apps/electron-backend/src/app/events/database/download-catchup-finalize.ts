import {
    archiveFileStats,
    readArchiveStats,
    type ArchiveFileStats,
} from './download-catchup-stats';
import type { DownloadTask, CompletedPartialProgress } from './download-task';
import { cleanupCatchupFile } from './download-catchup-cleanup';
import { constants } from 'node:fs';
import { link, open } from 'node:fs/promises';
import {
    archiveFileIdentity,
    sameArchiveFileIdentity,
    type ArchiveFileIdentity,
} from './download-catchup-output';
import type { ReservedPartialDownloadFile } from './download-file-path';

function verify(
    stats: ArchiveFileStats,
    identity: ArchiveFileIdentity,
    size: number
): void {
    if (
        !stats.isFile() ||
        !sameArchiveFileIdentity(stats, identity) ||
        stats.size !== size
    ) {
        throw new Error('Archive partial changed before promotion');
    }
}

/** Verify both sides of promotion; fallback copying reads a verified descriptor. */
export async function finalizeCatchupPartial(
    reservation: ReservedPartialDownloadFile,
    identity: ArchiveFileIdentity | undefined,
    size: number,
    recordProof?: (identity: ArchiveFileIdentity) => Promise<void>,
    shouldInterrupt: () => boolean = () => false,
    beginCommit: () => void = () => undefined,
    cleanup?: {
        partial: () => Promise<unknown>;
        final: (identity: ArchiveFileIdentity) => Promise<unknown>;
    }
): Promise<{ size: number; identity: ArchiveFileIdentity }> {
    const checkInterruption = () => {
        if (shouldInterrupt()) throw new Error('Archive promotion interrupted');
    };
    checkInterruption();
    if (!identity) throw new Error('Archive transfer identity is unavailable');
    verify(await readArchiveStats(reservation.partialPath), identity, size);
    const source = await open(
        reservation.partialPath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    let created: ArchiveFileIdentity | undefined;
    let sourceClosed = false;
    try {
        verify(
            archiveFileStats(await source.stat({ bigint: true })),
            identity,
            size
        );
        // A hardlink can become complete immediately: persist its expected
        // identity before publishing it, while the verified partial still exists.
        await recordProof?.(identity);
        checkInterruption();
        try {
            await link(reservation.partialPath, reservation.path);
            // The link we created belongs to the verified source, even if
            // another writer replaces its public name before lstat completes.
            created = identity;
            const promoted = await readArchiveStats(reservation.path);
            verify(promoted, identity, size);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (
                created ||
                ![
                    'EACCES',
                    'EPERM',
                    'EXDEV',
                    'ENOSYS',
                    'ENOTSUP',
                    'EOPNOTSUPP',
                ].includes(code ?? '')
            )
                throw error;
            // FAT/network filesystems may not support links. Never reopen the
            // source by pathname for this copy: it could have been replaced.
            const target = await open(reservation.path, 'wx', 0o600);
            try {
                created = archiveFileStats(await target.stat({ bigint: true }));
                // For a copy, record the exclusively created target identity
                // before the first byte, so a complete file never lacks proof.
                await recordProof?.(created);
                const buffer = Buffer.alloc(64 * 1024);
                let position = 0;
                while (position < size) {
                    checkInterruption();
                    const { bytesRead } = await source.read(
                        buffer,
                        0,
                        Math.min(buffer.length, size - position),
                        position
                    );
                    if (bytesRead === 0)
                        throw new Error(
                            'Archive partial ended during promotion'
                        );
                    let written = 0;
                    while (written < bytesRead) {
                        checkInterruption();
                        const { bytesWritten } = await target.write(
                            buffer,
                            written,
                            bytesRead - written,
                            position + written
                        );
                        if (bytesWritten === 0)
                            throw new Error(
                                'Archive promotion made no progress'
                            );
                        written += bytesWritten;
                    }
                    position += bytesRead;
                }
            } finally {
                await target.close();
            }
        }
        await source.close();
        sourceClosed = true;
        checkInterruption();
        verify(await readArchiveStats(reservation.path), created, size);
        checkInterruption();
        // Publication is verified. Fence new commands before awaited cleanup
        // and the completion write; accepted commands were handled above.
        beginCommit();
        await (
            cleanup
                ? cleanup.partial()
                : cleanupCatchupFile(reservation.partialPath, identity)
        ).catch(() => undefined);
        return { size, identity: archiveFileIdentity(created) };
    } catch (error) {
        if (created) {
            await (
                cleanup
                    ? cleanup.final(created)
                    : cleanupCatchupFile(reservation.path, created)
            ).catch(() => undefined);
        }
        throw error;
    } finally {
        if (!sourceClosed) await source.close();
    }
}

/** A DB retry can reuse completion only with explicit, still-current proof. */
export async function recoverCatchupCompletion(
    task: DownloadTask
): Promise<CompletedPartialProgress | null> {
    const proof = task.catchupFinalized;
    if (!proof || proof.filePath !== task.filePath) return null;
    try {
        const file = await readArchiveStats(proof.filePath);
        return file.isFile() &&
            sameArchiveFileIdentity(file, proof.identity) &&
            file.size === proof.size
            ? {
                  filePath: proof.filePath,
                  bytesDownloaded: proof.size,
                  totalBytes: proof.size,
              }
            : null;
    } catch {
        return null;
    }
}
