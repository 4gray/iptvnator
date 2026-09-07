import { statfs } from 'node:fs/promises';
import { Transform } from 'node:stream';

const GiB = 1024 ** 3;
export const ARCHIVE_DISK_RESERVE = GiB;
const DISK_CHECK_INTERVAL = 16 * 1024 ** 2;
const limitError = () =>
    new Error('Archive download exceeds the size or free-space limit');

async function availableBytes(directory: string): Promise<number> {
    const stats = await statfs(directory);
    return Math.max(0, stats.bavail * stats.bsize - ARCHIVE_DISK_RESERVE);
}

/** A generous 100 Mbit/s ceiling, with a minute of padding and a 64 GiB cap. */
export async function getArchiveByteLimit(
    directory: string,
    durationSeconds: number,
    declaredBytes: number | null
): Promise<number> {
    const limit = Math.floor(
        Math.min(
            (durationSeconds + 60) * 12_500_000,
            64 * GiB,
            (await availableBytes(directory)) / 2
        )
    );
    if (limit < 188 * 3 || (declaredBytes !== null && declaredBytes > limit))
        throw limitError();
    return limit;
}

/** Count before forwarding any bytes, including unknown-length TS responses. */
export function createArchiveByteGuard(
    directory: string,
    limit: number
): Transform {
    let received = 0;
    let sinceDiskCheck = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length;
            sinceDiskCheck += chunk.length;
            if (received > limit) {
                callback(limitError());
                return;
            }
            if (sinceDiskCheck >= DISK_CHECK_INTERVAL) {
                sinceDiskCheck = 0;
                availableBytes(directory).then(
                    (available) => {
                        callback(
                            available < received + chunk.length
                                ? limitError()
                                : null,
                            chunk
                        );
                    },
                    (error: Error) => callback(error)
                );
            } else callback(null, chunk);
        },
    });
}

/** Recheck after the output stream closes, including a sub-checkpoint tail. */
export async function assertArchiveCopyHeadroom(
    directory: string,
    finalSize: number
): Promise<void> {
    if ((await availableBytes(directory)) < finalSize) throw limitError();
}
