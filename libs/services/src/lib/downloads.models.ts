import type {
    DownloadMetadataSnapshot,
    ElectronBridgeDownloadStatus,
    ElectronBridgeDownloadStartPayload,
    ElectronDownloadFileAvailability,
} from '@iptvnator/shared/interfaces';

export type DownloadStatus = ElectronBridgeDownloadStatus;

export type DownloadStartInput = Omit<
    ElectronBridgeDownloadStartPayload,
    'downloadFolder'
>;

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
    metadataSnapshot?: DownloadMetadataSnapshot;
    status: DownloadStatus;
    bytesDownloaded?: number;
    totalBytes?: number;
    errorMessage?: string;
    createdAt?: string;
    updatedAt?: string;
}
