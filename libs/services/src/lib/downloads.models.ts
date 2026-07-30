import type { ElectronDownloadFileAvailability } from '@iptvnator/shared/interfaces';

export type DownloadStatus =
    'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'canceled';

export interface DownloadItem {
    id: number;
    playlistId: string;
    xtreamId: number;
    contentType: 'vod' | 'episode';
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    title: string;
    url: string;
    fileName?: string;
    filePath?: string;
    fileAvailability?: ElectronDownloadFileAvailability;
    posterUrl?: string;
    status: DownloadStatus;
    bytesDownloaded?: number;
    totalBytes?: number;
    errorMessage?: string;
    createdAt?: string;
    updatedAt?: string;
}
