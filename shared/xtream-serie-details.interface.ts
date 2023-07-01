export interface XtreamSerieDetails {
    seasons: XtreamSerieSeason[];
    info: XtreamSerieInfo;
    episodes: Record<string, XtreamSerieEpisode[]>;
}

export interface XtreamSerieInfo {
    name: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    releaseDate: string;
    last_modified: string;
    rating: string;
    rating_5based: number;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    category_id: string;
}

export interface XtreamSerieEpisode {
    id: string;
    episode_num: number;
    title: string;
    container_extension: string;
    info: {
        tmdb_id: number;
        releasedate: string;
        plot: string;
        duration_secs: number;
        duration: string;
        movie_image: string;
        video: Record<string, string>; // TODO
        audio: Record<string, string>; // TODO
        bitrate: number;
        rating: number;
        season: string;
    };
    custom_sid: string;
    added: string;
    season: number;
    direct_source: string;
}

export interface XtreamSerieSeason {
    air_date: string;
    episode_count: number;
    id: number;
    name: string;
    overview: string;
    season_number: number;
    cover: string;
    cover_big: string;
}
