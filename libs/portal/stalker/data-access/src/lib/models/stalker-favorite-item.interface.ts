import {
    StalkerVodDetails,
    StalkerVodInfo,
} from 'shared-interfaces';

export type StalkerSeriesFlag = true | 1 | '1';

/**
 * Loose source shape coming from Stalker responses / favorites payloads.
 * Keep optional to model heterogeneous portal responses.
 */
export interface StalkerVodSource {
    id?: string | number;
    stream_id?: string | number;
    movie_id?: string | number;
    series_id?: string | number;
    cmd?: string;
    series?: unknown[];
    has_files?: number;
    is_series?: boolean | number | string | null | undefined;
    video_id?: string;
    category_id?: string;
    title?: string;
    cover?: string;
    logo?: string;
    screenshot_uri?: string;
    name?: string;
    o_name?: string;
    description?: string;
    actors?: string;
    director?: string;
    releasedate?: string;
    year?: string;
    genre?: string;
    genres_str?: string;
    rating_imdb?: string | number;
    rating_kinopoisk?: string | number;
    info?: Partial<StalkerVodInfo> | null;
}

/**
 * Normalized VOD item used by Stalker detail/favorites flows.
 */
export interface StalkerSelectedVodItem extends StalkerVodDetails {
    series?: unknown[];
    has_files?: number;
    is_series?: true;
    video_id?: string;
    category_id?: string;
}

/**
 * Favorite item persisted for Stalker portal.
 */
export interface StalkerFavoriteItem {
    id?: string | number;
    stream_id?: string | number;
    movie_id?: string | number;
    series_id?: string | number;
    category_id?: string;
    cmd?: string;
    name?: string;
    o_name?: string;
    logo?: string;
    details?: StalkerSelectedVodItem;
    [key: string]: unknown;
}
