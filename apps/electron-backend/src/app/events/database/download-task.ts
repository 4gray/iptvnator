import type { getDatabase } from '../../database/connection';

export type DownloadsDatabase = Awaited<ReturnType<typeof getDatabase>>;

export interface TransferProgress {
    bytesDownloaded: number;
    totalBytes: number | null;
}

export interface CompletedPartialProgress extends TransferProgress {
    filePath: string;
}

export interface DownloadTask {
    id: number;
    url: string;
    fileName: string;
    directory: string;
    headers?: Record<string, string>;
    cancelRequested?: boolean;
    pauseRequested?: boolean;
    abortController?: AbortController;
    filePath?: string | null;
    totalBytes?: number | null;
    /** ETag/Last-Modified of the entity the partial belongs to (If-Range). */
    resumeValidator?: string | null;
    /**
     * Times this task discarded its partial and rewrote from byte zero
     * (overlap mismatch, shrunk entity, 416, or a server that ignored
     * Range). The reconnect loop reads it to open a fresh progress epoch —
     * an explicit signal, because a rebuild that happens to land near the
     * previous attempt's byte count is indistinguishable from a stall by
     * byte comparison alone.
     */
    transferRestarts?: number;
    // The previous attempt verified the complete overlap of an indeterminate
    // range and appended nothing: the partial may already BE the complete
    // unknown-length entity. The next attempt requests the byte AFTER the
    // partial so a compliant 416 (Content-Range `bytes */N`) can confirm
    // completion, which the ordinary rewound request can never observe.
    // One-shot; consumed at the start of the next attempt.
    probeEof?: boolean;
}

export function requestDownloadCancellation(task: DownloadTask): void {
    task.cancelRequested = true;
    task.abortController?.abort();
}

export function requestDownloadPause(task: DownloadTask): void {
    task.pauseRequested = true;
    task.abortController?.abort();
}
