import {
    extractStalkerItemType,
    type StalkerPortalItem,
} from '@iptvnator/shared/interfaces';

type DownloadContentType = 'vod' | 'episode';

function normalizedPortalId(value: unknown): string {
    return String(value ?? '')
        .trim()
        .split(':')[0];
}

function hasValue(value: unknown): boolean {
    return String(value ?? '').trim().length > 0;
}

function isTruthySeriesFlag(value: unknown): boolean {
    return value === true || value === 1 || value === '1';
}

function isSeriesItem(item: StalkerPortalItem): boolean {
    const raw = item as Record<string, unknown>;
    const category = String(item.category_id ?? '')
        .trim()
        .toLowerCase();
    const streamType = String(item.stream_type ?? '')
        .trim()
        .toLowerCase();
    const customSid = String(raw['custom_sid'] ?? '')
        .trim()
        .toLowerCase();

    return (
        hasValue(item.series_id) ||
        category === 'series' ||
        streamType === 'series' ||
        isTruthySeriesFlag(item.is_series) ||
        (Array.isArray(item.series) && item.series.length > 0) ||
        customSid === 'regular-series' ||
        customSid === 'vod-series'
    );
}

function matchesContentType(
    item: StalkerPortalItem,
    contentType: DownloadContentType
): boolean {
    if (extractStalkerItemType(item) === 'live') {
        return false;
    }

    const seriesItem = isSeriesItem(item);
    return contentType === 'episode' ? seriesItem : !seriesItem;
}

export function findMatchingStalkerDownloadRecent(
    items: readonly StalkerPortalItem[],
    expectedId: number,
    contentType: DownloadContentType
): StalkerPortalItem | undefined {
    const expected = String(expectedId);

    return items.find(
        (item) =>
            matchesContentType(item, contentType) &&
            [item.id, item.movie_id, item.series_id, item.stream_id].some(
                (candidate) => normalizedPortalId(candidate) === expected
            )
    );
}
