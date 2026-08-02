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
    readonly seriesXtreamId?: number | null;
    readonly seasonNumber?: number | null;
    readonly episodeNumber?: number | null;
    readonly status: ElectronBridgeDownloadStatus;
    readonly fileAvailability?: ElectronDownloadFileAvailability;
    readonly filePath?: string;
}

export type EpisodeDownloadResolution<T extends EpisodeDownloadRecord> =
    | { readonly kind: 'match'; readonly download: T }
    | { readonly kind: 'missing' }
    | { readonly kind: 'conflict' };

function hasConflictingCompleteCoordinates(
    download: EpisodeDownloadRecord,
    identity: EpisodeDownloadIdentity
): boolean {
    const { seriesXtreamId, seasonNumber, episodeNumber } = download;
    if (
        seriesXtreamId === null ||
        seriesXtreamId === undefined ||
        seasonNumber === null ||
        seasonNumber === undefined ||
        episodeNumber === null ||
        episodeNumber === undefined
    ) {
        return false;
    }

    return (
        !Number.isSafeInteger(seriesXtreamId) ||
        !Number.isSafeInteger(seasonNumber) ||
        !Number.isSafeInteger(episodeNumber) ||
        seriesXtreamId !== identity.seriesXtreamId ||
        seasonNumber !== identity.seasonNumber ||
        episodeNumber !== identity.episodeNumber
    );
}

export function resolveEpisodeDownload<T extends EpisodeDownloadRecord>(
    identity: EpisodeDownloadIdentity,
    downloads: readonly T[]
): EpisodeDownloadResolution<T> {
    const canonicalMatch = downloads.find(
        (download) =>
            download.playlistId === identity.playlistId &&
            download.contentType === identity.contentType &&
            download.xtreamId === identity.xtreamId
    );
    const coordinateMatches = downloads.filter(
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
    if (coordinateMatches.length > 1) {
        return { kind: 'conflict' };
    }
    const coordinateMatch = coordinateMatches[0];

    if (canonicalMatch) {
        if (
            hasConflictingCompleteCoordinates(canonicalMatch, identity) ||
            (coordinateMatch && coordinateMatch.id !== canonicalMatch.id)
        ) {
            return { kind: 'conflict' };
        }
        return { kind: 'match', download: canonicalMatch };
    }

    return coordinateMatch
        ? { kind: 'match', download: coordinateMatch }
        : { kind: 'missing' };
}

export function isEpisodeDownloadEligible(
    resolution: EpisodeDownloadResolution<EpisodeDownloadRecord>
): boolean {
    if (resolution.kind === 'missing') {
        return true;
    }
    if (resolution.kind === 'conflict') {
        return false;
    }
    const { download } = resolution;
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
