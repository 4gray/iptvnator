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
}

export function requestDownloadCancellation(task: DownloadTask): void {
    task.cancelRequested = true;
    task.abortController?.abort();
}

export function requestDownloadPause(task: DownloadTask): void {
    task.pauseRequested = true;
    task.abortController?.abort();
}
