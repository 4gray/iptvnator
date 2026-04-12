export interface XtreamVodInfo {
    kinopoisk_url: string;
    tmdb_id: number | string;
    name: string;
    o_name: string;
    cover_big: string;
    movie_image: string;
    releasedate: string;
    episode_run_time: number;
    youtube_trailer: string;
    director: string;
    actors: string;
    cast: string;
    description: string;
    plot: string;
    age: string;
    mpaa_rating: string;
    rating_count_kinopoisk: number;
    country: string;
    genre: string;
    backdrop_path: string[];
    duration_secs: number;
    duration: string;
    video: string[];
    audio: string[];
    bitrate: number;
    rating: number | string;
    runtime?: string;
    status?: string;
    rating_kinopoisk?: string;
    rating_imdb?: string;
}

export interface XtreamVodMovieData {
    stream_id: number;
    name: string;
    added: string;
    category_id: string;
    container_extension: string;
    custom_sid: string | null;
    direct_source: string;
    category_ids?: number[];
}

export interface XtreamVodDetails {
    info?: XtreamVodInfo | [] | null;
    movie_data?: XtreamVodMovieData;
}

export function getXtreamVodInfo(
    details: Pick<XtreamVodDetails, 'info'> | null | undefined
): XtreamVodInfo | null {
    const info = details?.info;
    if (!info || Array.isArray(info) || typeof info !== 'object') {
        return null;
    }
    return info;
}

export function hasXtreamVodInfo(
    details: Pick<XtreamVodDetails, 'info'> | null | undefined
): details is XtreamVodDetails & { info: XtreamVodInfo } {
    return getXtreamVodInfo(details) !== null;
}
