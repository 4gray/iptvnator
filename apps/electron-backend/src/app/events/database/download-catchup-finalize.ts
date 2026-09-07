import { cleanupCatchupFile } from './download-catchup-cleanup';
import { constants, type Stats } from 'node:fs';
import { link, lstat, open } from 'node:fs/promises';
import type { ArchiveFileIdentity } from './download-catchup-output';
import type { ReservedPartialDownloadFile } from './download-file-path';

function sameFile(
    stats: ArchiveFileIdentity,
    identity: ArchiveFileIdentity
): boolean {
    return stats.dev === identity.dev && stats.ino === identity.ino;
}

function verify(
    stats: Stats,
    identity: ArchiveFileIdentity,
    size: number
): void {
    if (!stats.isFile() || !sameFile(stats, identity) || stats.size !== size) {
        throw new Error('Archive partial changed before promotion');
    }
}

/** Verify both sides of promotion; fallback copying reads a verified descriptor. */
export async function finalizeCatchupPartial(
    reservation: ReservedPartialDownloadFile,
    identity: ArchiveFileIdentity | undefined,
    size: number
): Promise<number> {
    if (!identity) throw new Error('Archive transfer identity is unavailable');
    verify(await lstat(reservation.partialPath), identity, size);
    const source = await open(
        reservation.partialPath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    let created: ArchiveFileIdentity | undefined;
    try {
        verify(await source.stat(), identity, size);
        try {
            await link(reservation.partialPath, reservation.path);
            // The link we created belongs to the verified source, even if
            // another writer replaces its public name before lstat completes.
            created = identity;
            const promoted = await lstat(reservation.path);
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
                created = await target.stat();
                const buffer = Buffer.alloc(64 * 1024);
                let position = 0;
                while (position < size) {
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
        verify(await lstat(reservation.path), created, size);
        await cleanupCatchupFile(reservation.partialPath, identity).catch(
            () => undefined
        );
        return size;
    } catch (error) {
        if (created) {
            await cleanupCatchupFile(reservation.path, created).catch(
                () => undefined
            );
        }
        throw error;
    } finally {
        await source.close();
    }
}
