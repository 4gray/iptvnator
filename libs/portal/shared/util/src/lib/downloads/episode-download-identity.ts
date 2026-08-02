import type {
    ElectronBridgeDownloadStatus,
    ElectronBridgePlaybackContentType,
    ElectronDownloadFileAvailability,
} from '@iptvnator/shared/interfaces';

export interface EpisodeDownloadIdentity {
    readonly playlistId: string;
    readonly contentType: 'episode';
    readonly xtreamId: number;
    readonly seriesXtreamId: number;
    readonly seasonNumber: number;
    readonly episodeNumber: number;
}

export interface EpisodeDownloadRecord {
    readonly id: number;
    readonly playlistId: string;
    readonly contentType: ElectronBridgePlaybackContentType;
    readonly xtreamId: number;
    readonly seriesXtreamId?: number;
    readonly seasonNumber?: number;
    readonly episodeNumber?: number;
    readonly status: ElectronBridgeDownloadStatus;
    readonly fileAvailability?: ElectronDownloadFileAvailability;
    readonly filePath?: string;
}

export function findEpisodeDownload<T extends EpisodeDownloadRecord>(
    identity: EpisodeDownloadIdentity,
    downloads: readonly T[]
): T | undefined {
    const canonicalMatch = downloads.find(
        (download) =>
            download.playlistId === identity.playlistId &&
            download.contentType === identity.contentType &&
            download.xtreamId === identity.xtreamId
    );
    if (canonicalMatch) {
        return canonicalMatch;
    }

    return downloads.find(
        (download) =>
            download.playlistId === identity.playlistId &&
            download.contentType === identity.contentType &&
            download.seriesXtreamId !== undefined &&
            download.seriesXtreamId === identity.seriesXtreamId &&
            download.seasonNumber !== undefined &&
            download.seasonNumber === identity.seasonNumber &&
            download.episodeNumber !== undefined &&
            download.episodeNumber === identity.episodeNumber
    );
}

export function isEpisodeDownloadEligible(
    download: EpisodeDownloadRecord | undefined
): boolean {
    if (!download) {
        return true;
    }
    if (download.status === 'completed') {
        return download.fileAvailability === 'missing';
    }
    return download.status === 'failed' || download.status === 'canceled';
}

export function createEpisodeDownloadIdentityKey(
    identity: EpisodeDownloadIdentity
): string {
    return JSON.stringify({
        playlistId: identity.playlistId,
        contentType: identity.contentType,
        xtreamId: identity.xtreamId,
        seriesXtreamId: identity.seriesXtreamId,
        seasonNumber: identity.seasonNumber,
        episodeNumber: identity.episodeNumber,
    });
}
