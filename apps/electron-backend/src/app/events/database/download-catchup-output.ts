import { constants, type WriteStream } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

export interface ArchiveFileIdentity {
    readonly dev: number;
    readonly ino: number;
}

/** Open without truncation first: a replaced partial must not damage its target. */
export async function openCatchupOutput(
    partialPath: string,
    expectedIdentity?: ArchiveFileIdentity,
    beforeTruncate?: () => Promise<void>
): Promise<{ stream: WriteStream; identity: ArchiveFileIdentity }> {
    const before = await lstat(partialPath).catch(
        (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
        }
    );
    if (before && (!before.isFile() || before.nlink !== 1)) {
        throw new Error('Archive partial is not an exclusive regular file');
    }
    const handle = await open(
        partialPath,
        constants.O_WRONLY |
            (constants.O_NOFOLLOW ?? 0) |
            (before ? 0 : constants.O_CREAT | constants.O_EXCL),
        0o600
    );
    try {
        const current = await handle.stat();
        // Descriptor identity also protects platforms without O_NOFOLLOW from
        // a link/file replacement between lstat and open. Missing files use wx.
        if (
            !current.isFile() ||
            current.nlink !== 1 ||
            (before &&
                (current.dev !== before.dev || current.ino !== before.ino)) ||
            (before &&
                expectedIdentity &&
                (current.dev !== expectedIdentity.dev ||
                    current.ino !== expectedIdentity.ino))
        ) {
            throw new Error('Archive partial changed before opening');
        }
        // Keep durable ownership evidence until the actual descriptor passes.
        await beforeTruncate?.();
        await handle.truncate(0);
        // All writes use this verified descriptor; never reopen by pathname.
        return {
            stream: handle.createWriteStream({ autoClose: true }),
            identity: { dev: current.dev, ino: current.ino },
        };
    } catch (error) {
        await handle.close();
        throw error;
    }
}
