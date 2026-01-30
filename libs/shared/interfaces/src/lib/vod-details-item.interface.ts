import { XtreamVodDetails } from './xtream-vod-details.interface';
import { StalkerVodDetails } from './stalker-vod-details.interface';

/**
 * Discriminated union for VOD details across portal types.
 * Enables type-safe handling without runtime type checks.
 *
 * @example
 * ```typescript
 * function handleVod(item: VodDetailsItem) {
 *   if (item.type === 'xtream') {
 *     // TypeScript knows item.data is XtreamVodDetails
 *     console.log(item.data.movie_data.stream_id);
 *   } else {
 *     // TypeScript knows item.data is StalkerVodDetails
 *     console.log(item.data.cmd);
 *   }
 * }
 * ```
 */
export type VodDetailsItem = XtreamVodItem | StalkerVodItem;

/**
 * Xtream Codes VOD item wrapper with context.
 */
export interface XtreamVodItem {
    /** Discriminator for Xtream Codes portals */
    readonly type: 'xtream';
    /** Full VOD details from Xtream API */
    data: XtreamVodDetails;
    /** Playlist/portal ID for favorites and downloads */
    playlistId: string;
    /** Stream ID from Xtream API */
    vodId: number;
}

/**
 * Stalker portal VOD item wrapper with context.
 */
export interface StalkerVodItem {
    /** Discriminator for Stalker portals */
    readonly type: 'stalker';
    /** Full VOD details from Stalker API */
    data: StalkerVodDetails;
    /** Playlist/portal ID for favorites and downloads */
    playlistId: string;
    /** Command string for stream playback */
    cmd: string;
}

/**
 * Normalized metadata for display in templates.
 * Provides a consistent interface regardless of portal type.
 */
export interface NormalizedVodMeta {
    /** Movie title */
    title: string;
    /** Plot description */
    description?: string;
    /** Poster/cover image URL */
    posterUrl?: string;
    /** Backdrop image URL (Xtream only) */
    backdropUrl?: string;
    /** Release year (4 digits) */
    year?: string;
    /** Genre(s) */
    genre?: string;
    /** Duration string (e.g., "1h 30m") */
    duration?: string;
    /** Country of origin (Xtream only) */
    country?: string;
    /** Director name */
    director?: string;
    /** Actors/cast (comma-separated) */
    actors?: string;
    /** IMDB rating */
    ratingImdb?: string;
    /** Kinopoisk rating */
    ratingKinopoisk?: string;
    /** YouTube trailer ID (Xtream only) */
    youtubeTrailer?: string;
}

/**
 * Type guard to check if item is Xtream VOD.
 */
export function isXtreamVod(item: VodDetailsItem): item is XtreamVodItem {
    return item.type === 'xtream';
}

/**
 * Type guard to check if item is Stalker VOD.
 */
export function isStalkerVod(item: VodDetailsItem): item is StalkerVodItem {
    return item.type === 'stalker';
}
