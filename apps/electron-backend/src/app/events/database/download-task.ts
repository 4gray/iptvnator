import type { DownloadItem } from 'electron';

export interface DownloadTask {
    id: number;
    url: string;
    fileName: string;
    directory: string;
    headers?: Record<string, string>;
    cancelRequested?: boolean;
    downloadItem?: DownloadItem;
    reservedPath?: string;
}

export function attachDownloadItem(
    task: DownloadTask,
    item: DownloadItem
): void {
    task.downloadItem = item;
    if (task.cancelRequested) {
        item.cancel();
    }
}

export function requestDownloadCancellation(task: DownloadTask): void {
    task.cancelRequested = true;
    task.downloadItem?.cancel();
}
