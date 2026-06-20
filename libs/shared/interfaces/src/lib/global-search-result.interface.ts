import { Channel } from './channel.interface';

export const GLOBAL_SEARCH_RESULT_SOURCES = {
    Xtream: 'xtream',
    M3u: 'm3u',
} as const;

export type GlobalSearchResultSource =
    (typeof GLOBAL_SEARCH_RESULT_SOURCES)[keyof typeof GLOBAL_SEARCH_RESULT_SOURCES];

export interface GlobalSearchPaginationOptions {
    limit?: number;
    offset?: number;
}

export const GLOBAL_SEARCH_CONTENT_TYPES = {
    Live: 'live',
    Movie: 'movie',
    Series: 'series',
} as const;

export type GlobalSearchContentType =
    (typeof GLOBAL_SEARCH_CONTENT_TYPES)[keyof typeof GLOBAL_SEARCH_CONTENT_TYPES];

export interface GlobalSearchBaseResult {
    source_type: GlobalSearchResultSource;
    content_type: GlobalSearchContentType;
    id: number | string;
    category_id: number | string;
    title: string;
    rating: string | null;
    added: string | null;
    poster_url: string | null;
    xtream_id: number;
    type: GlobalSearchContentType;
    playlist_id: string;
    playlist_name: string;
}

export interface XtreamGlobalSearchResult extends GlobalSearchBaseResult {
    source_type: typeof GLOBAL_SEARCH_RESULT_SOURCES.Xtream;
    description?: string;
    backdrop_url?: string | null;
    epg_channel_id?: string | null;
    tv_archive?: number | null;
    tv_archive_duration?: number | null;
    direct_source?: string | null;
    added_at?: string;
    viewed_at?: string;
    position?: number | null;
}

export interface M3uGlobalSearchResult extends GlobalSearchBaseResult {
    source_type: typeof GLOBAL_SEARCH_RESULT_SOURCES.M3u;
    content_type: typeof GLOBAL_SEARCH_CONTENT_TYPES.Live;
    type: typeof GLOBAL_SEARCH_CONTENT_TYPES.Live;
    channel_id: string;
    stream_url: string;
    group_title: string;
    radio: string;
    channel: Channel;
}

export type GlobalSearchResult =
    | XtreamGlobalSearchResult
    | M3uGlobalSearchResult;

export function isM3uGlobalSearchResult(
    result: GlobalSearchResult
): result is M3uGlobalSearchResult {
    return result.source_type === GLOBAL_SEARCH_RESULT_SOURCES.M3u;
}
