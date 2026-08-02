import { unlink } from 'node:fs/promises';
import { getPartialDownloadPath } from './download-file-path';

export type DownloadPartialCleanupResult = 'removed' | 'missing' | 'unknown';

export type DownloadAsyncUnlink = (filePath: string) => Promise<void>;

export type DownloadPartialCleanup = (
    filePath: string
) => Promise<DownloadPartialCleanupResult>;

const DEFAULT_MAX_CONCURRENT_PARTIAL_CLEANUPS = 4;
const DEFAULT_PARTIAL_CLEANUP_TIMEOUT_MS = 1_000;

function isMissingFileSystemError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return false;
    }
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

export function createPartialDownloadCleanup(
    asyncUnlink: DownloadAsyncUnlink = unlink,
    maxConcurrent = DEFAULT_MAX_CONCURRENT_PARTIAL_CLEANUPS
): DownloadPartialCleanup {
    const concurrency = Math.max(1, Math.floor(maxConcurrent));
    const pending: Array<() => void> = [];
    const inFlight = new Map<string, Promise<DownloadPartialCleanupResult>>();
    let active = 0;

    const acquire = (): Promise<void> => {
        if (active < concurrency) {
            active += 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => pending.push(resolve));
    };

    const release = (): void => {
        const next = pending.shift();
        if (next) {
            next();
        } else {
            active -= 1;
        }
    };

    const remove = async (
        filePath: string
    ): Promise<DownloadPartialCleanupResult> => {
        await acquire();
        try {
            await asyncUnlink(getPartialDownloadPath(filePath));
            return 'removed';
        } catch (error) {
            return isMissingFileSystemError(error) ? 'missing' : 'unknown';
        } finally {
            release();
        }
    };

    return (filePath: string) => {
        const existing = inFlight.get(filePath);
        if (existing) {
            return existing;
        }

        const cleanup = remove(filePath);
        inFlight.set(filePath, cleanup);
        const clear = () => {
            if (inFlight.get(filePath) === cleanup) {
                inFlight.delete(filePath);
            }
        };
        void cleanup.then(clear, clear);
        return cleanup;
    };
}

const cleanupPartialDownloadFile = createPartialDownloadCleanup();

export async function removePartialDownloadFileWithTimeoutAsync(
    filePath: string | null | undefined,
    timeoutMs = DEFAULT_PARTIAL_CLEANUP_TIMEOUT_MS,
    cleanup: DownloadPartialCleanup = cleanupPartialDownloadFile
): Promise<DownloadPartialCleanupResult> {
    if (!filePath) {
        return 'missing';
    }

    const boundedTimeoutMs =
        Number.isFinite(timeoutMs) && timeoutMs >= 0
            ? timeoutMs
            : DEFAULT_PARTIAL_CLEANUP_TIMEOUT_MS;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'unknown'>((resolve) => {
        timeout = setTimeout(() => resolve('unknown'), boundedTimeoutMs);
    });

    try {
        return await Promise.race([cleanup(filePath), timedOut]);
    } catch {
        return 'unknown';
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}
