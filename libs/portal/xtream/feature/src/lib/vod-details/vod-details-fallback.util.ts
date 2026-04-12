import {
    XtreamVodDetails,
    XtreamVodInfo,
    XtreamVodStream,
    getXtreamVodInfo,
} from 'shared-interfaces';

type XtreamCategoryContext = {
    readonly id?: string | number;
    readonly name?: string;
    readonly category_id?: string | number;
    readonly category_name?: string;
};

type XtreamVodCatalogContext = Partial<XtreamVodStream> & {
    readonly added_at?: string | number;
    readonly id?: string | number;
    readonly poster_url?: string;
    readonly title?: string;
    readonly xtream_id?: string | number;
};

type XtreamVodDetailsContext = XtreamVodDetails &
    Partial<XtreamVodStream> & {
        readonly added_at?: string | number;
        readonly id?: string | number;
        readonly poster_url?: string;
        readonly title?: string;
        readonly xtream_id?: string | number;
    };

export interface XtreamVodFallbackFact {
    readonly labelKey: string;
    readonly monospace?: boolean;
    readonly value: string;
}

export interface XtreamVodFallbackViewModel {
    readonly added?: string;
    readonly facts: XtreamVodFallbackFact[];
    readonly format?: string;
    readonly posterUrl?: string;
    readonly rating?: string;
    readonly title: string;
    readonly year?: string;
}

export interface XtreamVodFallbackOptions {
    readonly category?: XtreamCategoryContext | null;
    readonly catalogItem?: XtreamVodCatalogContext | null;
    readonly vodDetails?: XtreamVodDetails | null;
    readonly vodId: number;
}

export function hasUsableXtreamVodMetadata(
    vodDetails: XtreamVodDetails | null | undefined
): vodDetails is XtreamVodDetails & { info: XtreamVodInfo } {
    const info = getXtreamVodInfo(vodDetails);
    if (!info) {
        return false;
    }

    return Boolean(
        info.description ||
            info.plot ||
            info.movie_image ||
            info.cover_big ||
            info.genre ||
            info.releasedate ||
            info.duration ||
            info.duration_secs ||
            info.country ||
            info.director ||
            info.actors ||
            info.cast ||
            info.youtube_trailer ||
            info.rating_imdb ||
            info.rating_kinopoisk ||
            info.backdrop_path?.length
    );
}

export function buildXtreamVodFallbackViewModel(
    options: XtreamVodFallbackOptions
): XtreamVodFallbackViewModel | null {
    const detailItem = options.vodDetails as XtreamVodDetailsContext | null;
    const info = getXtreamVodInfo(detailItem);
    const movieData = detailItem?.movie_data;
    const catalogItem = options.catalogItem;
    const categoryName =
        options.category?.name ?? options.category?.category_name;
    const streamId =
        movieData?.stream_id ??
        numericValue(detailItem?.xtream_id) ??
        numericValue(detailItem?.stream_id) ??
        numericValue(detailItem?.id) ??
        numericValue(catalogItem?.xtream_id) ??
        numericValue(catalogItem?.stream_id) ??
        numericValue(catalogItem?.id) ??
        options.vodId;
    const sourceTitle =
        sanitizeText(detailItem?.title) ??
        sanitizeText(detailItem?.name) ??
        sanitizeText(catalogItem?.title) ??
        sanitizeText(catalogItem?.name);
    const title =
        sanitizeText(movieData?.name) ??
        sourceTitle ??
        sanitizeText(info?.name) ??
        `VOD ${streamId}`;
    const posterUrl =
        sanitizeText(detailItem?.poster_url) ??
        sanitizeText(detailItem?.stream_icon) ??
        sanitizeText(catalogItem?.poster_url) ??
        sanitizeText(catalogItem?.stream_icon) ??
        sanitizeText(info?.movie_image) ??
        sanitizeText(info?.cover_big) ??
        undefined;
    const rating =
        sanitizeText(detailItem?.rating_imdb) ??
        formatRating(detailItem?.rating) ??
        sanitizeText(catalogItem?.rating_imdb) ??
        formatRating(catalogItem?.rating);
    const added = formatUnixDate(
        movieData?.added ??
            detailItem?.added_at ??
            detailItem?.added ??
            catalogItem?.added_at ??
            catalogItem?.added
    );
    const format = sanitizeText(
        movieData?.container_extension ??
            detailItem?.container_extension ??
            catalogItem?.container_extension
    )?.toUpperCase();
    const year = extractYear(info?.releasedate) ?? extractYear(title);

    const facts: XtreamVodFallbackFact[] = [
        {
            labelKey: 'XTREAM.DETAIL_FALLBACK.STREAM_ID',
            monospace: true,
            value: String(streamId),
        },
    ];

    if (categoryName) {
        facts.push({
            labelKey: 'XTREAM.DETAIL_FALLBACK.CATEGORY',
            value: categoryName,
        });
    }

    if (format) {
        facts.push({
            labelKey: 'XTREAM.DETAIL_FALLBACK.CONTAINER',
            monospace: true,
            value: format,
        });
    }

    if (sourceTitle && sourceTitle !== title) {
        facts.push({
            labelKey: 'XTREAM.DETAIL_FALLBACK.SOURCE_TITLE',
            value: sourceTitle,
        });
    }

    return {
        added,
        facts,
        format,
        posterUrl,
        rating,
        title,
        year,
    };
}

function sanitizeText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function numericValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return undefined;
}

function formatRating(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toFixed(1);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }

    return undefined;
}

function extractYear(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const yearMatch = value.match(/\b(19|20)\d{2}\b/);
    return yearMatch?.[0];
}

function formatUnixDate(value: unknown): string | undefined {
    const seconds = numericValue(value);
    if (!seconds) {
        return undefined;
    }

    try {
        return new Date(seconds * 1000).toISOString().slice(0, 10);
    } catch {
        return undefined;
    }
}
