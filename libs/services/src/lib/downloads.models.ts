import type {
    CatchupDownloadMetadata,
    DownloadContentType,
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
    contentType: DownloadContentType;
    catchup?: CatchupDownloadMetadata | null;
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    episodeIdentityScope?:
        ElectronBridgeDownloadStartPayload['episodeIdentityScope'] | null;
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
