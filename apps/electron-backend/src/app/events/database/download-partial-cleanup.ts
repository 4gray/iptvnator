import { unlink } from 'node:fs/promises';
import { getPartialDownloadPath } from './download-file-path';

export type DownloadPartialCleanupResult = 'removed' | 'missing' | 'unknown';

export type DownloadAsyncUnlink = (filePath: string) => Promise<void>;

export type DownloadPartialCleanup = (
    filePath: string,
    admissionTimeoutMs?: number
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
    // Only admission can time out. Once unlink starts, every coalesced caller
    // awaits its authoritative result so no late deletion can race a retry.
    const inFlight = new Map<string, Promise<DownloadPartialCleanupResult>>();
    let active = 0;

    const acquire = (timeoutMs: number): Promise<boolean> => {
        if (active < concurrency) {
            active += 1;
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            let settled = false;
            const start = () => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                resolve(true);
            };
            const timeout = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                const index = pending.indexOf(start);
                if (index >= 0) {
                    pending.splice(index, 1);
                }
                resolve(false);
            }, timeoutMs);
            pending.push(start);
        });
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
        filePath: string,
        admissionTimeoutMs: number
    ): Promise<DownloadPartialCleanupResult> => {
        if (!(await acquire(admissionTimeoutMs))) {
            return 'unknown';
        }
        try {
            await asyncUnlink(getPartialDownloadPath(filePath));
            return 'removed';
        } catch (error) {
            return isMissingFileSystemError(error) ? 'missing' : 'unknown';
        } finally {
            release();
        }
    };

    return (
        filePath: string,
        admissionTimeoutMs = DEFAULT_PARTIAL_CLEANUP_TIMEOUT_MS
    ) => {
        const existing = inFlight.get(filePath);
        if (existing) {
            return existing;
        }

        const cleanup = remove(filePath, admissionTimeoutMs);
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

export async function removePartialDownloadFileAsync(
    filePath: string | null | undefined,
    admissionTimeoutMs = DEFAULT_PARTIAL_CLEANUP_TIMEOUT_MS,
    cleanup: DownloadPartialCleanup = cleanupPartialDownloadFile
): Promise<DownloadPartialCleanupResult> {
    if (!filePath) {
        return 'missing';
    }

    const boundedAdmissionTimeoutMs =
        Number.isFinite(admissionTimeoutMs) && admissionTimeoutMs >= 0
            ? admissionTimeoutMs
            : DEFAULT_PARTIAL_CLEANUP_TIMEOUT_MS;

    try {
        return await cleanup(filePath, boundedAdmissionTimeoutMs);
    } catch {
        return 'unknown';
    }
}
