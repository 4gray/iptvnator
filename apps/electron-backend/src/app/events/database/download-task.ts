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
}

export function requestDownloadCancellation(task: DownloadTask): void {
    task.cancelRequested = true;
    task.abortController?.abort();
}

export function requestDownloadPause(task: DownloadTask): void {
    task.pauseRequested = true;
    task.abortController?.abort();
}
