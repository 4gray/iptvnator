import type { DownloadItem } from '@iptvnator/services';

export interface DownloadLibraryRow {
    readonly item: DownloadItem;
    readonly episodeLabel: string;
    readonly sourceName: string;
}

interface DownloadLibraryEntityBase {
    readonly key: string;
    readonly newestTimestamp: number;
    readonly sourceName: string;
    readonly trackedBytes: number;
}

interface DownloadItemLibraryEntityBase extends DownloadLibraryEntityBase {
    readonly item: DownloadItem;
}

export interface DownloadMovieCardViewModel extends DownloadItemLibraryEntityBase {
    readonly kind: 'movie';
}

export interface DownloadEpisodeCardViewModel extends DownloadItemLibraryEntityBase {
    readonly kind: 'episode';
    readonly episodeLabel: string;
}

export interface DownloadSeriesCardViewModel extends DownloadLibraryEntityBase {
    readonly kind: 'series';
    readonly representative: DownloadItem;
    readonly members: readonly DownloadItem[];
    readonly seriesXtreamId: number;
    readonly title: string;
    readonly posterUrl?: string;
    readonly firstSeason?: number;
    readonly lastSeason?: number;
}

export type DownloadLibraryEntity =
    | DownloadMovieCardViewModel
    | DownloadEpisodeCardViewModel
    | DownloadSeriesCardViewModel;

const STANDARD_EPISODE_TITLE = /^(.+?) - S\d{2}E\d{2} - /;
const MALFORMED_DOWNLOAD_ID_CLASS = {
    NAN: '0:nan',
    NEGATIVE_INFINITY: '1:negative-infinity',
    NEGATIVE: '2:negative',
    ZERO: '3:zero',
    FRACTIONAL: '4:fractional',
    UNSAFE: '5:unsafe',
    POSITIVE_INFINITY: '6:positive-infinity',
} as const;

export function normalizedDownloadTimestamp(value: string | undefined): number {
    const timestamp = Date.parse(value ?? '');
    return Number.isFinite(timestamp) ? timestamp : 0;
}

export function isUsableDownloadOrderNumber(
    value: number | undefined
): value is number {
    return Number.isSafeInteger(value) && value !== undefined && value >= 0;
}

function malformedDownloadIdKey(value: number): string {
    if (Number.isNaN(value)) {
        return MALFORMED_DOWNLOAD_ID_CLASS.NAN;
    }
    if (value === Number.NEGATIVE_INFINITY) {
        return MALFORMED_DOWNLOAD_ID_CLASS.NEGATIVE_INFINITY;
    }
    if (value === Number.POSITIVE_INFINITY) {
        return MALFORMED_DOWNLOAD_ID_CLASS.POSITIVE_INFINITY;
    }
    if (value < 0) {
        return `${MALFORMED_DOWNLOAD_ID_CLASS.NEGATIVE}:${String(value)}`;
    }
    if (value === 0) {
        return MALFORMED_DOWNLOAD_ID_CLASS.ZERO;
    }
    if (!Number.isInteger(value)) {
        return `${MALFORMED_DOWNLOAD_ID_CLASS.FRACTIONAL}:${String(value)}`;
    }
    return `${MALFORMED_DOWNLOAD_ID_CLASS.UNSAFE}:${String(value)}`;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

export function compareDownloadIds(
    left: number,
    right: number,
    descending = false
): number {
    const leftValid = Number.isSafeInteger(left) && left > 0;
    const rightValid = Number.isSafeInteger(right) && right > 0;
    if (leftValid && rightValid) {
        const first = descending ? right : left;
        const second = descending ? left : right;
        return first < second ? -1 : first > second ? 1 : 0;
    }
    if (leftValid) {
        return -1;
    }
    if (rightValid) {
        return 1;
    }
    return compareText(
        malformedDownloadIdKey(left),
        malformedDownloadIdKey(right)
    );
}

export function deriveStandardizedSeriesTitle(
    item: DownloadItem
): string | undefined {
    if (item.contentType !== 'episode') {
        return undefined;
    }
    return STANDARD_EPISODE_TITLE.exec(item.title)?.[1];
}

function compareOrderNumber(
    left: number | undefined,
    right: number | undefined
): number {
    const leftUsable = isUsableDownloadOrderNumber(left);
    const rightUsable = isUsableDownloadOrderNumber(right);
    if (leftUsable && rightUsable) {
        return left - right;
    }
    if (leftUsable) {
        return -1;
    }
    return rightUsable ? 1 : 0;
}

function compareMembers(left: DownloadItem, right: DownloadItem): number {
    return (
        compareOrderNumber(left.seasonNumber, right.seasonNumber) ||
        compareOrderNumber(left.episodeNumber, right.episodeNumber) ||
        normalizedDownloadTimestamp(left.createdAt) -
            normalizedDownloadTimestamp(right.createdAt) ||
        compareDownloadIds(left.id, right.id)
    );
}

function compareNewest(left: DownloadItem, right: DownloadItem): number {
    return (
        normalizedDownloadTimestamp(right.createdAt) -
            normalizedDownloadTimestamp(left.createdAt) ||
        compareDownloadIds(left.id, right.id, true)
    );
}

function isValidSeriesId(value: number | undefined): value is number {
    return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

function createSeriesEntity(
    rows: readonly DownloadLibraryRow[],
    seriesXtreamId: number
): DownloadSeriesCardViewModel {
    const members = rows.map(({ item }) => item).sort(compareMembers);
    const newestFirst = [...members].sort(compareNewest);
    const representative = newestFirst[0];
    const posterUrl = newestFirst.find(
        (item) => (item.posterUrl?.trim().length ?? 0) > 0
    )?.posterUrl;
    const standardizedTitle = members
        .map(deriveStandardizedSeriesTitle)
        .find((title) => title !== undefined);
    const legacyTitle =
        members.find((item) => item.title.trim().length > 0)?.title ?? '';
    const seasons = members
        .map(({ seasonNumber }) => seasonNumber)
        .filter(isUsableDownloadOrderNumber);

    return {
        kind: 'series',
        key: `series:${representative.playlistId}:${seriesXtreamId}`,
        representative,
        members,
        seriesXtreamId,
        title: standardizedTitle ?? legacyTitle,
        ...(posterUrl === undefined ? {} : { posterUrl }),
        newestTimestamp: normalizedDownloadTimestamp(representative.createdAt),
        sourceName: rows[0].sourceName,
        trackedBytes: members.reduce(
            (total, item) => total + (item.bytesDownloaded ?? 0),
            0
        ),
        ...(seasons.length === 0
            ? {}
            : {
                  firstSeason: Math.min(...seasons),
                  lastSeason: Math.max(...seasons),
              }),
    };
}

export function buildDownloadLibrary(
    rows: readonly DownloadLibraryRow[]
): DownloadLibraryEntity[] {
    const entities: DownloadLibraryEntity[] = [];
    const groups = new Map<
        string,
        {
            readonly seriesXtreamId: number;
            readonly rows: DownloadLibraryRow[];
        }
    >();

    for (const row of rows) {
        const { item } = row;
        if (item.contentType === 'vod') {
            entities.push({
                kind: 'movie',
                key: `movie:${item.id}`,
                item,
                newestTimestamp: normalizedDownloadTimestamp(item.createdAt),
                sourceName: row.sourceName,
                trackedBytes: item.bytesDownloaded ?? 0,
            });
        } else if (isValidSeriesId(item.seriesXtreamId)) {
            const key = `${item.playlistId}:${item.seriesXtreamId}`;
            const group = groups.get(key);
            if (group) {
                group.rows.push(row);
            } else {
                groups.set(key, {
                    seriesXtreamId: item.seriesXtreamId,
                    rows: [row],
                });
            }
        } else {
            entities.push({
                kind: 'episode',
                key: `episode:${item.id}`,
                item,
                newestTimestamp: normalizedDownloadTimestamp(item.createdAt),
                sourceName: row.sourceName,
                trackedBytes: item.bytesDownloaded ?? 0,
                episodeLabel: row.episodeLabel,
            });
        }
    }

    for (const { rows: members, seriesXtreamId } of groups.values()) {
        entities.push(createSeriesEntity(members, seriesXtreamId));
    }

    return entities.sort(
        (left, right) =>
            right.newestTimestamp - left.newestTimestamp ||
            (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    );
}
