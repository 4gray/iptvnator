import type { DownloadItem } from '@iptvnator/services';
import type {
    DownloadEpisodeMetadata,
    DownloadMetadataSnapshot,
} from '@iptvnator/shared/interfaces';

/**
 * Missing or invalid season/episode coordinates are presented as specials.
 * Zero is stable, numeric, and keeps locally available legacy files visible.
 */
export const DOWNLOAD_OFFLINE_COORDINATE_FALLBACK = 0;

export interface DownloadOfflineEpisode {
    readonly item: DownloadItem;
    readonly seasonNumber: number;
    readonly episodeNumber: number;
    readonly episodeMetadata?: DownloadEpisodeMetadata;
}

export interface DownloadOfflineSeason {
    readonly seasonNumber: number;
    readonly episodes: readonly DownloadOfflineEpisode[];
}

export interface DownloadOfflineMovieDetail {
    readonly kind: 'movie';
    readonly item: DownloadItem;
    readonly snapshot?: DownloadMetadataSnapshot;
}

export interface DownloadOfflineSeriesDetail {
    readonly kind: 'series';
    readonly representative: DownloadItem;
    readonly snapshot?: DownloadMetadataSnapshot;
    readonly seasons: readonly DownloadOfflineSeason[];
}

export type DownloadOfflineDetail =
    DownloadOfflineMovieDetail | DownloadOfflineSeriesDetail;

export interface BuildDownloadOfflineDetailInput {
    readonly downloadId: number;
    readonly downloads: readonly DownloadItem[];
}

function isPositiveSafeInteger(value: number | undefined): value is number {
    return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

function isLocallyAvailable(item: DownloadItem): boolean {
    return (
        item.status === 'completed' &&
        (item.filePath?.trim().length ?? 0) > 0 &&
        item.fileAvailability !== 'missing'
    );
}

function parsedTimestamp(value: string | undefined): number | undefined {
    const timestamp = Date.parse(value ?? '');
    return Number.isFinite(timestamp) ? timestamp : undefined;
}

function normalizedTimestamp(value: string | undefined): number {
    return parsedTimestamp(value) ?? 0;
}

function normalizedCoordinate(value: number | undefined): number {
    return Number.isSafeInteger(value) && (value ?? -1) >= 0
        ? (value as number)
        : DOWNLOAD_OFFLINE_COORDINATE_FALLBACK;
}

function snapshotForKind(
    item: DownloadItem,
    mediaKind: DownloadMetadataSnapshot['mediaKind']
): DownloadMetadataSnapshot | undefined {
    const candidate = item.metadataSnapshot;
    return candidate?.version === 1 && candidate.mediaKind === mediaKind
        ? candidate
        : undefined;
}

function compareIdsNewestFirst(left: number, right: number): number {
    if (left === right) {
        return 0;
    }
    return right < left ? -1 : 1;
}

function effectiveSeriesSnapshotTimestamp(item: DownloadItem): number {
    const snapshot = snapshotForKind(item, 'series');
    for (const value of [
        snapshot?.enrichedAt,
        item.updatedAt,
        item.createdAt,
    ]) {
        const timestamp = parsedTimestamp(value);
        if (timestamp !== undefined) {
            return timestamp;
        }
    }
    return 0;
}

function selectSeriesSnapshot(
    members: readonly DownloadItem[]
): DownloadMetadataSnapshot | undefined {
    const candidates = members
        .filter((item) => snapshotForKind(item, 'series') !== undefined)
        .sort(
            (left, right) =>
                effectiveSeriesSnapshotTimestamp(right) -
                    effectiveSeriesSnapshotTimestamp(left) ||
                compareIdsNewestFirst(left.id, right.id)
        );

    return candidates.length === 0
        ? undefined
        : snapshotForKind(candidates[0], 'series');
}

function toOfflineEpisode(item: DownloadItem): DownloadOfflineEpisode {
    const seasonNumber = normalizedCoordinate(item.seasonNumber);
    const episodeNumber = normalizedCoordinate(item.episodeNumber);
    const episodeMetadata = snapshotForKind(item, 'series')?.episode;

    return {
        item,
        seasonNumber,
        episodeNumber,
        ...(episodeMetadata === undefined ? {} : { episodeMetadata }),
    };
}

function compareOfflineEpisodes(
    left: DownloadOfflineEpisode,
    right: DownloadOfflineEpisode
): number {
    return (
        left.seasonNumber - right.seasonNumber ||
        left.episodeNumber - right.episodeNumber ||
        normalizedTimestamp(left.item.createdAt) -
            normalizedTimestamp(right.item.createdAt) ||
        left.item.id - right.item.id
    );
}

function buildSeasons(
    members: readonly DownloadItem[]
): readonly DownloadOfflineSeason[] {
    const episodes = members.map(toOfflineEpisode).sort(compareOfflineEpisodes);
    const grouped = new Map<number, DownloadOfflineEpisode[]>();

    for (const episode of episodes) {
        const season = grouped.get(episode.seasonNumber);
        if (season) {
            season.push(episode);
        } else {
            grouped.set(episode.seasonNumber, [episode]);
        }
    }

    return [...grouped].map(([seasonNumber, seasonEpisodes]) => ({
        seasonNumber,
        episodes: seasonEpisodes,
    }));
}

function buildSeriesDetail(
    representative: DownloadItem,
    downloads: readonly DownloadItem[]
): DownloadOfflineSeriesDetail | undefined {
    const seriesXtreamId = representative.seriesXtreamId;
    if (
        seriesXtreamId !== undefined &&
        !isPositiveSafeInteger(seriesXtreamId)
    ) {
        return undefined;
    }

    const members =
        seriesXtreamId === undefined
            ? [representative]
            : downloads.filter(
                  (item) =>
                      isPositiveSafeInteger(item.id) &&
                      isLocallyAvailable(item) &&
                      item.contentType === 'episode' &&
                      item.playlistId === representative.playlistId &&
                      item.seriesXtreamId === seriesXtreamId
              );
    const snapshot = selectSeriesSnapshot(members);

    return {
        kind: 'series',
        representative,
        ...(snapshot === undefined ? {} : { snapshot }),
        seasons: buildSeasons(members),
    };
}

export function buildDownloadOfflineDetail({
    downloadId,
    downloads,
}: BuildDownloadOfflineDetailInput): DownloadOfflineDetail | undefined {
    if (!isPositiveSafeInteger(downloadId)) {
        return undefined;
    }

    const representative = downloads.find(({ id }) => id === downloadId);
    if (!representative || !isLocallyAvailable(representative)) {
        return undefined;
    }

    if (representative.contentType === 'vod') {
        const snapshot = snapshotForKind(representative, 'movie');
        return {
            kind: 'movie',
            item: representative,
            ...(snapshot === undefined ? {} : { snapshot }),
        };
    }

    return buildSeriesDetail(representative, downloads);
}
