import { XtreamVodDetails, getXtreamVodInfo } from './xtream-vod-details.interface';
import { StalkerVodDetails } from './stalker-vod-details.interface';
import {
    NormalizedVodMeta,
    VodDetailsItem,
    XtreamVodItem,
    StalkerVodItem,
} from './vod-details-item.interface';

/**
 * Normalizes Xtream VOD details into a display-friendly format.
 * Handles the various field name variations in Xtream API responses.
 */
export function normalizeXtreamVod(item: XtreamVodDetails): NormalizedVodMeta {
    const info = getXtreamVodInfo(item);
    const movieData = item?.movie_data;

    return {
        title: info?.name || movieData?.name || 'Unknown',
        description: info?.description || info?.plot,
        posterUrl: info?.movie_image || info?.cover_big,
        backdropUrl: info?.backdrop_path?.[0],
        year: extractYear(info?.releasedate),
        genre: info?.genre,
        duration: info?.duration || formatDuration(info?.duration_secs),
        country: info?.country,
        director: info?.director,
        actors: info?.actors || info?.cast,
        ratingImdb: info?.rating_imdb,
        ratingKinopoisk: info?.rating_kinopoisk,
        youtubeTrailer: info?.youtube_trailer,
        tmdbCast: info?.tmdb_cast,
    };
}

/**
 * Normalizes Stalker VOD details into a display-friendly format.
 * Stalker has fewer metadata fields than Xtream.
 * Prefers o_name (original title) over name (often formatted/generic).
 */
export function normalizeStalkerVod(item: StalkerVodDetails): NormalizedVodMeta {
    const info = item?.info;

    return {
        title: info?.o_name || info?.name || 'Unknown',
        description: info?.description,
        posterUrl: info?.movie_image,
        // Stalker portals never provide a backdrop; TMDB enrichment can
        backdropUrl: info?.tmdb_backdrop,
        year: extractYear(info?.releasedate),
        genre: info?.genre,
        duration: undefined, // Stalker doesn't provide duration
        country: undefined, // Stalker doesn't provide country
        director: info?.director,
        actors: info?.actors,
        ratingImdb: info?.rating_imdb,
        ratingKinopoisk: info?.rating_kinopoisk,
        // Stalker portals provide no trailers; TMDB enrichment can
        youtubeTrailer: info?.tmdb_trailer,
        tmdbCast: info?.tmdb_cast,
    };
}

/**
 * Builds a YouTube embed URL from the various trailer formats providers
 * send: a plain video id (also what TMDB supplies), a full watch URL, or a
 * youtu.be short link. Returns `null` when no id can be extracted. Uses the
 * privacy-enhanced youtube-nocookie host (must stay in sync with the CSP
 * frame-src allowlist in apps/web/src/index.html).
 */
export function youtubeEmbedUrl(
    trailer: string | null | undefined
): string | null {
    const raw = trailer?.trim();
    if (!raw) {
        return null;
    }

    // Two linear passes instead of one "watch\?.*v=" alternation, which
    // backtracks polynomially on hostile input (CodeQL js/polynomial-redos)
    let videoId = raw;
    if (/youtube(?:-nocookie)?\.com\/watch\?/.test(raw)) {
        videoId = raw.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1] ?? '';
    } else {
        const urlMatch = raw.match(
            /(?:youtube(?:-nocookie)?\.com\/(?:embed|shorts)\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/
        );
        if (urlMatch) {
            videoId = urlMatch[1];
        }
    }

    return /^[A-Za-z0-9_-]{6,}$/.test(videoId)
        ? `https://www.youtube-nocookie.com/embed/${videoId}`
        : null;
}

/**
 * Normalizes any VodDetailsItem to display-friendly format.
 * Uses discriminated union for type-safe handling.
 */
export function normalizeVodDetails(item: VodDetailsItem): NormalizedVodMeta {
    if (item.type === 'xtream') {
        return normalizeXtreamVod(item.data);
    }
    return normalizeStalkerVod(item.data);
}

/**
 * Creates an XtreamVodItem from raw data and context.
 */
export function createXtreamVodItem(
    data: XtreamVodDetails,
    playlistId: string,
    vodId?: number
): XtreamVodItem {
    return {
        type: 'xtream',
        data,
        playlistId,
        vodId: vodId ?? data.movie_data?.stream_id ?? 0,
    };
}

/**
 * Creates a StalkerVodItem from raw data and context.
 */
export function createStalkerVodItem(
    data: StalkerVodDetails,
    playlistId: string
): StalkerVodItem {
    return {
        type: 'stalker',
        data,
        playlistId,
        cmd: data.cmd,
    };
}

/**
 * Gets the unique identifier for a VOD item.
 * Returns vodId for Xtream, id for Stalker.
 */
export function getVodId(item: VodDetailsItem): number | string {
    if (item.type === 'xtream') {
        return item.vodId;
    }
    return item.data.id;
}

/**
 * Gets the numeric ID for download/favorite tracking.
 */
export function getVodNumericId(item: VodDetailsItem): number {
    if (item.type === 'xtream') {
        return item.vodId;
    }
    return Number(item.data.id) || 0;
}

// ============ Helper Functions ============

/**
 * Extracts 4-digit year from various date formats.
 */
function extractYear(dateString?: string): string | undefined {
    if (!dateString) return undefined;

    // Try to extract 4-digit year from beginning
    const yearMatch = dateString.match(/^(\d{4})/);
    if (yearMatch) {
        return yearMatch[1];
    }

    // Try to parse as date and extract year
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
        return date.getFullYear().toString();
    }

    return dateString.slice(0, 4);
}

/**
 * Formats duration from seconds to human-readable string.
 */
function formatDuration(seconds?: number): string | undefined {
    if (!seconds || seconds <= 0) return undefined;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}
