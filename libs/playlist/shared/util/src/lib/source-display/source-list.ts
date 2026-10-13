import {
    foldSearchText,
    PlaylistMeta,
    PlaylistSourceKind,
    resolvePlaylistSourceKind,
    SourceStatusBucket,
} from '@iptvnator/shared/interfaces';
import { sourceDisplayName, sourceHost } from './source-display';

export type SourcesTypeFilter = 'all' | PlaylistSourceKind;
export type SourcesStatusFilter = 'all' | SourceStatusBucket;

export interface SourcesFilter {
    type: SourcesTypeFilter;
    status: SourcesStatusFilter;
}

/** A source's status bucket; null for local files and unchecked sources. */
export type SourceBucketOf = (
    playlist: PlaylistMeta
) => SourceStatusBucket | null;

export type SourceTypeCounts = Record<SourcesTypeFilter, number>;
export type SourceStatusCounts = Record<SourcesStatusFilter, number>;

export function matchesSourceType(
    playlist: PlaylistMeta,
    type: SourcesTypeFilter
): boolean {
    return type === 'all' || resolvePlaylistSourceKind(playlist) === type;
}

export function matchesSourceStatus(
    playlist: PlaylistMeta,
    status: SourcesStatusFilter,
    bucketOf: SourceBucketOf
): boolean {
    return status === 'all' || bucketOf(playlist) === status;
}

/**
 * Search by what the row shows: the name (stored and displayed) and the
 * host, folded for case and accents. An empty query matches everything.
 */
export function matchesSourceQuery(
    playlist: PlaylistMeta,
    query: string
): boolean {
    const folded = foldSearchText(query).trim();
    if (!folded) {
        return true;
    }
    const haystack = [
        playlist.title,
        playlist.filename,
        sourceDisplayName(playlist),
        sourceHost(playlist),
    ];
    return haystack.some(
        (value) => !!value && foldSearchText(value).includes(folded)
    );
}

export function filterSources(
    playlists: readonly PlaylistMeta[],
    filter: SourcesFilter,
    query: string,
    bucketOf: SourceBucketOf
): PlaylistMeta[] {
    return playlists.filter(
        (playlist) =>
            matchesSourceType(playlist, filter.type) &&
            matchesSourceStatus(playlist, filter.status, bucketOf) &&
            matchesSourceQuery(playlist, query)
    );
}

/** Type counts within the current status choice, as the side list shows. */
export function countSourcesByType(
    playlists: readonly PlaylistMeta[],
    status: SourcesStatusFilter,
    bucketOf: SourceBucketOf
): SourceTypeCounts {
    const counts: SourceTypeCounts = { all: 0, m3u: 0, xtream: 0, stalker: 0 };
    for (const playlist of playlists) {
        if (matchesSourceStatus(playlist, status, bucketOf)) {
            counts.all += 1;
            counts[resolvePlaylistSourceKind(playlist)] += 1;
        }
    }
    return counts;
}

/** Status counts within the current type choice. */
export function countSourcesByStatus(
    playlists: readonly PlaylistMeta[],
    type: SourcesTypeFilter,
    bucketOf: SourceBucketOf
): SourceStatusCounts {
    const counts: SourceStatusCounts = { all: 0, ok: 0, bad: 0 };
    for (const playlist of playlists) {
        if (matchesSourceType(playlist, type)) {
            counts.all += 1;
            const bucket = bucketOf(playlist);
            if (bucket) {
                counts[bucket] += 1;
            }
        }
    }
    return counts;
}

/** Moves sources that do not respond to the top, keeping the order. */
export function orderFailingFirst(
    playlists: readonly PlaylistMeta[],
    bucketOf: SourceBucketOf
): PlaylistMeta[] {
    const failing: PlaylistMeta[] = [];
    const rest: PlaylistMeta[] = [];
    for (const playlist of playlists) {
        (bucketOf(playlist) === 'bad' ? failing : rest).push(playlist);
    }
    return [...failing, ...rest];
}

/**
 * The source that takes over when `removedId` leaves a list: the nearest
 * row after it, else before it, skipping rows that are leaving too (a
 * delete still running). Null when no other source can take over.
 */
export function replacementAfterRemoval<T extends { _id: string }>(
    rows: readonly T[],
    removedId: string,
    leaving: (row: T) => boolean
): T | null {
    const index = rows.findIndex((row) => row._id === removedId);
    if (index === -1) {
        return null;
    }
    for (let next = index + 1; next < rows.length; next += 1) {
        if (!leaving(rows[next])) {
            return rows[next];
        }
    }
    for (let previous = index - 1; previous >= 0; previous -= 1) {
        if (!leaving(rows[previous])) {
            return rows[previous];
        }
    }
    return null;
}
