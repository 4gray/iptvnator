import type { DownloadItem } from '@iptvnator/services';
import type {
    DownloadEpisodeMetadata,
    DownloadMetadataSnapshot,
} from '@iptvnator/shared/interfaces';

type DeepReadonlyAtomic =
    bigint | boolean | null | number | string | symbol | undefined;

export type DeepReadonly<T> = T extends DeepReadonlyAtomic
    ? T
    : T extends (...args: never[]) => unknown
      ? T
      : T extends readonly (infer Item)[]
        ? readonly DeepReadonly<Item>[]
        : T extends object
          ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
          : T;

export type DownloadOfflineSeasonCoordinate =
    | {
          readonly seasonNumber: number;
          readonly seasonNumberState: 'known';
      }
    | {
          readonly seasonNumber: null;
          readonly seasonNumberState: 'unknown';
      };

export type DownloadOfflineEpisodeCoordinate =
    | {
          readonly episodeNumber: number;
          readonly episodeNumberState: 'known';
      }
    | {
          readonly episodeNumber: null;
          readonly episodeNumberState: 'unknown';
      };

export type DownloadOfflineEpisode = DownloadOfflineSeasonCoordinate &
    DownloadOfflineEpisodeCoordinate & {
        readonly item: DeepReadonly<DownloadItem>;
        readonly episodeMetadata?: DeepReadonly<DownloadEpisodeMetadata>;
    };

export type DownloadOfflineSeason = DownloadOfflineSeasonCoordinate & {
    readonly episodes: readonly DownloadOfflineEpisode[];
};

export interface DownloadOfflineMovieDetail {
    readonly kind: 'movie';
    readonly item: DeepReadonly<DownloadItem>;
    readonly snapshot?: DeepReadonly<DownloadMetadataSnapshot>;
}

export interface DownloadOfflineSeriesDetail {
    readonly kind: 'series';
    readonly representative: DeepReadonly<DownloadItem>;
    readonly snapshot?: DeepReadonly<DownloadMetadataSnapshot>;
    readonly seasons: readonly DownloadOfflineSeason[];
}

export type DownloadOfflineDetail =
    DownloadOfflineMovieDetail | DownloadOfflineSeriesDetail;

export interface BuildDownloadOfflineDetailInput {
    readonly downloadId: number;
    readonly downloads: readonly DeepReadonly<DownloadItem>[];
}

type ReadonlyDownloadItem = DeepReadonly<DownloadItem>;

type NormalizedCoordinate =
    | {
          readonly state: 'known';
          readonly value: number;
          readonly sortBucket: 0;
      }
    | {
          readonly state: 'unknown';
          readonly value: null;
          readonly sortBucket: 1;
      };

type NormalizedTimestamp =
    | {
          readonly state: 'known';
          readonly value: number;
          readonly sortBucket: 0;
      }
    | {
          readonly state: 'unknown';
          readonly sortBucket: 1;
      };

interface SortableOfflineEpisode {
    readonly view: DownloadOfflineEpisode;
    readonly season: NormalizedCoordinate;
    readonly episode: NormalizedCoordinate;
    readonly createdAt: NormalizedTimestamp;
}

function isPositiveSafeInteger(value: number | undefined): value is number {
    return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

function isLocallyAvailable(item: ReadonlyDownloadItem): boolean {
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

function normalizedCoordinate(value: number | undefined): NormalizedCoordinate {
    if (Number.isSafeInteger(value) && (value ?? -1) >= 0) {
        return { state: 'known', value: value as number, sortBucket: 0 };
    }
    return { state: 'unknown', value: null, sortBucket: 1 };
}

function normalizedTimestamp(value: string | undefined): NormalizedTimestamp {
    const timestamp = parsedTimestamp(value);
    return timestamp === undefined
        ? { state: 'unknown', sortBucket: 1 }
        : { state: 'known', value: timestamp, sortBucket: 0 };
}

function snapshotForKind(
    item: ReadonlyDownloadItem,
    mediaKind: DownloadMetadataSnapshot['mediaKind']
): DeepReadonly<DownloadMetadataSnapshot> | undefined {
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

function effectiveSeriesSnapshotTimestamp(item: ReadonlyDownloadItem): number {
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
    members: readonly ReadonlyDownloadItem[]
): DeepReadonly<DownloadMetadataSnapshot> | undefined {
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

function seasonCoordinateFields(
    coordinate: NormalizedCoordinate
): DownloadOfflineSeasonCoordinate {
    return coordinate.state === 'known'
        ? { seasonNumber: coordinate.value, seasonNumberState: 'known' }
        : { seasonNumber: null, seasonNumberState: 'unknown' };
}

function episodeCoordinateFields(
    coordinate: NormalizedCoordinate
): DownloadOfflineEpisodeCoordinate {
    return coordinate.state === 'known'
        ? { episodeNumber: coordinate.value, episodeNumberState: 'known' }
        : { episodeNumber: null, episodeNumberState: 'unknown' };
}

function toSortableOfflineEpisode(
    item: ReadonlyDownloadItem
): SortableOfflineEpisode {
    const season = normalizedCoordinate(item.seasonNumber);
    const episode = normalizedCoordinate(item.episodeNumber);
    const episodeMetadata = snapshotForKind(item, 'series')?.episode;

    return {
        season,
        episode,
        createdAt: normalizedTimestamp(item.createdAt),
        view: {
            item,
            ...seasonCoordinateFields(season),
            ...episodeCoordinateFields(episode),
            ...(episodeMetadata === undefined ? {} : { episodeMetadata }),
        },
    };
}

function compareCoordinates(
    left: NormalizedCoordinate,
    right: NormalizedCoordinate
): number {
    return (
        left.sortBucket - right.sortBucket ||
        (left.state === 'known' && right.state === 'known'
            ? left.value - right.value
            : 0)
    );
}

function compareTimestamps(
    left: NormalizedTimestamp,
    right: NormalizedTimestamp
): number {
    return (
        left.sortBucket - right.sortBucket ||
        (left.state === 'known' && right.state === 'known'
            ? left.value - right.value
            : 0)
    );
}

function compareOfflineEpisodes(
    left: SortableOfflineEpisode,
    right: SortableOfflineEpisode
): number {
    return (
        compareCoordinates(left.season, right.season) ||
        compareCoordinates(left.episode, right.episode) ||
        compareTimestamps(left.createdAt, right.createdAt) ||
        left.view.item.id - right.view.item.id
    );
}

function buildSeasons(
    members: readonly ReadonlyDownloadItem[]
): readonly DownloadOfflineSeason[] {
    const episodes = members
        .map(toSortableOfflineEpisode)
        .sort(compareOfflineEpisodes);
    const grouped = new Map<
        number | null,
        {
            readonly coordinate: NormalizedCoordinate;
            readonly episodes: DownloadOfflineEpisode[];
        }
    >();

    for (const episode of episodes) {
        const season = grouped.get(episode.season.value);
        if (season) {
            season.episodes.push(episode.view);
        } else {
            grouped.set(episode.season.value, {
                coordinate: episode.season,
                episodes: [episode.view],
            });
        }
    }

    return [...grouped.values()].map(({ coordinate, episodes }) => ({
        ...seasonCoordinateFields(coordinate),
        episodes,
    }));
}

function buildSeriesDetail(
    representative: ReadonlyDownloadItem,
    downloads: readonly ReadonlyDownloadItem[]
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
