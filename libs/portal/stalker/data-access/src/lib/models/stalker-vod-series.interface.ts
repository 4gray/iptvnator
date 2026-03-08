/**
 * Season item returned by Stalker VOD-series (Ministra is_series=1) endpoints.
 */
export interface StalkerVodSeriesSeason {
    id: string;
    video_id: string;
    season_number?: string;
    name?: string;
    is_season?: boolean;
}

/**
 * Episode item returned by Stalker VOD-series season endpoints.
 */
export interface StalkerVodSeriesEpisode {
    id: string;
    series_number?: number;
    episode_num?: number;
    name?: string;
    cover?: string;
    description?: string;
    duration?: number | string;
    is_episode?: boolean;
}
