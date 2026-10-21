/**
 * IntroDB (https://api.introdb.app) — crowdsourced intro / recap / outro
 * timestamps for TV episodes, keyed by the series' IMDb id.
 *
 * The renderer cannot call it: the API only allows its own web origin, so
 * Electron fetches it in the main process (`INTRODB_GET_SEGMENTS`). These
 * types and the response normalization are shared by both sides.
 */

export interface IntroDbSegmentsRequest {
    /** IMDb id of the SERIES (`tt0903747`), not of the episode. */
    imdbId: string;
    seasonNumber: number;
    episodeNumber: number;
}

export interface IntroDbSegment {
    startSeconds: number;
    endSeconds: number;
}

export interface IntroDbEpisodeSegments {
    intro: IntroDbSegment | null;
    recap: IntroDbSegment | null;
    outro: IntroDbSegment | null;
}

const IMDB_ID_PATTERN = /^tt\d{7,10}$/;
/** Longer than any opening titles or recap; anything beyond is bad data. */
const MAX_SEGMENT_SECONDS = 15 * 60;

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Guards the IPC payload: the main process only ever builds its own URL. */
export function isIntroDbSegmentsRequest(
    value: unknown
): value is IntroDbSegmentsRequest {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const request = value as Partial<IntroDbSegmentsRequest>;
    return (
        typeof request.imdbId === 'string' &&
        IMDB_ID_PATTERN.test(request.imdbId) &&
        isPositiveInteger(request.seasonNumber) &&
        isPositiveInteger(request.episodeNumber)
    );
}

function readSeconds(
    segment: Record<string, unknown>,
    msKey: string,
    secKey: string
): number | null {
    const ms = segment[msKey];
    if (typeof ms === 'number' && Number.isFinite(ms)) {
        return ms / 1000;
    }
    const sec = segment[secKey];
    return typeof sec === 'number' && Number.isFinite(sec) ? sec : null;
}

function normalizeSegment(value: unknown): IntroDbSegment | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const segment = value as Record<string, unknown>;
    const startSeconds = readSeconds(segment, 'start_ms', 'start_sec');
    const endSeconds = readSeconds(segment, 'end_ms', 'end_sec');
    if (
        startSeconds === null ||
        endSeconds === null ||
        startSeconds < 0 ||
        endSeconds <= startSeconds ||
        endSeconds - startSeconds > MAX_SEGMENT_SECONDS
    ) {
        return null;
    }
    return { startSeconds, endSeconds };
}

/**
 * The `/segments` response reduced to validated second ranges. Missing,
 * malformed, reversed or implausibly long segments become null; a response
 * with none left is null as a whole.
 */
export function normalizeIntroDbSegments(
    data: unknown
): IntroDbEpisodeSegments | null {
    if (!data || typeof data !== 'object') {
        return null;
    }
    const body = data as Record<string, unknown>;
    const segments: IntroDbEpisodeSegments = {
        intro: normalizeSegment(body['intro']),
        recap: normalizeSegment(body['recap']),
        outro: normalizeSegment(body['outro']),
    };
    return segments.intro || segments.recap || segments.outro ? segments : null;
}
