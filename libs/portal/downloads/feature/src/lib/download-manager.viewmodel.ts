import type { DownloadItem } from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    buildDownloadLibrary,
    compareDownloadIds,
    deriveStandardizedSeriesTitle,
    isUsableDownloadOrderNumber,
    normalizedDownloadTimestamp,
    type DownloadLibraryEntity,
    type DownloadLibraryRow,
} from './download-library.viewmodel';

export type {
    DownloadEpisodeCardViewModel,
    DownloadLibraryEntity,
    DownloadMovieCardViewModel,
    DownloadSeriesCardViewModel,
} from './download-library.viewmodel';

export type DownloadFilterId =
    | 'all'
    | 'movie'
    | 'series'
    | 'in-progress'
    | 'recording';

export type DownloadAttentionReason = 'file-missing' | 'transfer';

export interface DownloadListItemViewModel extends DownloadLibraryRow {
    readonly attentionReason: DownloadAttentionReason;
    readonly seriesTitle: string;
}

export interface DownloadManagerCounts {
    readonly all: number;
    readonly movie: number;
    readonly series: number;
    readonly inProgress: number;
}

export interface DownloadManagerViewModel {
    readonly scopedItems: readonly DownloadItem[];
    readonly active: readonly DownloadListItemViewModel[];
    readonly attention: readonly DownloadListItemViewModel[];
    readonly library: readonly DownloadLibraryEntity[];
    readonly counts: DownloadManagerCounts;
    readonly activeCount: number;
    readonly trackedBytes: number;
    readonly hasClearable: boolean;
}

export interface BuildDownloadManagerViewModelInput {
    readonly downloads: readonly DownloadItem[];
    readonly playlists: readonly Pick<Playlist, '_id' | 'title'>[];
    readonly scopePlaylistId?: string;
    readonly filter: string | null | undefined;
    readonly searchTerm?: string;
}

export function normalizeDownloadFilter(
    value: string | null | undefined
): DownloadFilterId {
    switch (value) {
        case 'movie':
        case 'series':
        case 'in-progress':
        case 'recording':
            return value;
        default:
            return 'all';
    }
}

function episodeLabel(item: DownloadItem): string {
    if (
        item.contentType !== 'episode' ||
        !isUsableDownloadOrderNumber(item.seasonNumber) ||
        !isUsableDownloadOrderNumber(item.episodeNumber)
    ) {
        return '';
    }

    const season = String(item.seasonNumber).padStart(2, '0');
    const episode = String(item.episodeNumber).padStart(2, '0');
    return `S${season}E${episode}`;
}

function seriesTitle(item: DownloadItem): string {
    if (item.contentType !== 'episode') {
        return '';
    }
    return deriveStandardizedSeriesTitle(item) ?? item.title;
}

function isActive(item: DownloadItem): boolean {
    return (
        item.status === 'queued' ||
        item.status === 'downloading' ||
        item.status === 'paused'
    );
}

function needsAttention(item: DownloadItem): boolean {
    return item.status === 'failed' || item.status === 'canceled';
}

function isMissingCompletedFile(item: DownloadItem): boolean {
    return item.status === 'completed' && item.fileAvailability === 'missing';
}

function isReady(item: DownloadItem): boolean {
    return item.status === 'completed' && item.fileAvailability !== 'missing';
}

function compareQueued(
    left: DownloadListItemViewModel,
    right: DownloadListItemViewModel
): number {
    return (
        normalizedDownloadTimestamp(left.item.createdAt) -
            normalizedDownloadTimestamp(right.item.createdAt) ||
        compareDownloadIds(left.item.id, right.item.id)
    );
}

function matchesSearch(
    row: DownloadListItemViewModel,
    searchTerm: string
): boolean {
    const query = searchTerm.trim().toLowerCase();
    return (
        query.length === 0 ||
        [
            row.item.title,
            row.seriesTitle,
            row.sourceName,
            row.episodeLabel,
            row.item.errorMessage ?? '',
        ].some((value) => value.toLowerCase().includes(query))
    );
}

function matchesFilter(
    row: DownloadListItemViewModel,
    filter: DownloadFilterId
): boolean {
    if (filter === 'in-progress') {
        return isActive(row.item);
    }
    if (filter === 'movie') {
        return row.item.contentType === 'vod';
    }
    if (filter === 'series') {
        return row.item.contentType === 'episode';
    }
    // Recordings live in their own view model; the chip hides download rows
    // symmetrically to how the download chips hide recordings.
    if (filter === 'recording') {
        return false;
    }
    return true;
}

function countContentType(
    rows: readonly DownloadListItemViewModel[],
    contentType: DownloadItem['contentType']
): number {
    return rows.filter((row) => row.item.contentType === contentType).length;
}

export function buildDownloadManagerViewModel({
    downloads,
    playlists,
    scopePlaylistId,
    filter,
    searchTerm = '',
}: BuildDownloadManagerViewModelInput): DownloadManagerViewModel {
    const sourceNames = new Map(
        playlists.map(({ _id, title }) => [_id, title] as const)
    );
    const scopedItems = downloads.filter(
        (item) =>
            scopePlaylistId === undefined || item.playlistId === scopePlaylistId
    );
    const scopedRows = scopedItems.map((item) => ({
        attentionReason: isMissingCompletedFile(item)
            ? ('file-missing' as const)
            : ('transfer' as const),
        item,
        episodeLabel: episodeLabel(item),
        seriesTitle: seriesTitle(item),
        sourceName: sourceNames.get(item.playlistId) ?? '',
    }));
    const scopedActive = scopedRows.filter(({ item }) => isActive(item));
    const scopedAttention = scopedRows.filter(
        ({ item }) => needsAttention(item) || isMissingCompletedFile(item)
    );
    const scopedLibrary = buildDownloadLibrary(
        scopedRows.filter(({ item }) => isReady(item))
    );
    const activeFilter = normalizeDownloadFilter(filter);
    const displayed = scopedRows
        .filter((row) => matchesSearch(row, searchTerm))
        .filter((row) => matchesFilter(row, activeFilter));
    const active = displayed
        .filter(({ item }) => isActive(item))
        .sort(compareQueued);
    const attention = displayed
        .filter(
            ({ item }) => needsAttention(item) || isMissingCompletedFile(item)
        )
        .sort(compareQueued);
    const library = buildDownloadLibrary(
        displayed.filter(({ item }) => isReady(item))
    );

    return {
        scopedItems,
        active,
        attention,
        library,
        counts: {
            all:
                scopedActive.length +
                scopedAttention.length +
                scopedLibrary.length,
            movie:
                countContentType(scopedActive, 'vod') +
                countContentType(scopedAttention, 'vod') +
                scopedLibrary.filter(({ kind }) => kind === 'movie').length,
            series:
                countContentType(scopedActive, 'episode') +
                countContentType(scopedAttention, 'episode') +
                scopedLibrary.filter(({ kind }) => kind !== 'movie').length,
            inProgress: scopedActive.length,
        },
        activeCount: scopedItems.filter(
            (item) => item.status === 'queued' || item.status === 'downloading'
        ).length,
        trackedBytes: scopedItems.reduce(
            (total, item) => total + (item.bytesDownloaded ?? 0),
            0
        ),
        hasClearable: scopedItems.some(
            (item) =>
                item.status === 'completed' ||
                item.status === 'failed' ||
                item.status === 'canceled'
        ),
    };
}
