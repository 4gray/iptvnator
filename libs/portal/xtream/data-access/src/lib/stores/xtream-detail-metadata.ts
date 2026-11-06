import {
    readProviderRating,
    readProviderText,
    XtreamSerieInfo,
    XtreamVodInfo,
} from '@iptvnator/shared/interfaces';

const VOD_TEXT_FIELDS = [
    'name',
    'o_name',
    'movie_image',
    'cover_big',
    'releasedate',
    'genre',
    'duration',
    'country',
    'director',
    'actors',
    'cast',
    'description',
    'plot',
] as const satisfies readonly (keyof XtreamVodInfo)[];
const VOD_RATING_FIELDS = [
    'rating_imdb',
    'rating_kinopoisk',
] as const satisfies readonly (keyof XtreamVodInfo)[];

const SERIE_TEXT_FIELDS = [
    'name',
    'cover',
    'plot',
    'cast',
    'director',
    'genre',
    'releaseDate',
    'episode_run_time',
] as const satisfies readonly (keyof XtreamSerieInfo)[];
const SERIE_RATING_FIELDS = [
    'rating',
] as const satisfies readonly (keyof XtreamSerieInfo)[];

/**
 * Removes provider stand-ins (`"N/A"`, `"-"`, an unrated `"0"` score) from
 * an Xtream detail response before it becomes the store selection.
 *
 * The VOD and series detail routes bind these `info` fields directly, and
 * TMDB enrichment keeps any non-empty provider rating and release date — a
 * stand-in left here is both rendered and shields the TMDB value that should
 * have replaced it. Only string fields that are present are rewritten, to
 * `''` (how these shapes spell "absent"), so the response keeps its shape.
 */
export function stripXtreamVodInfoPlaceholders(
    info: XtreamVodInfo
): XtreamVodInfo {
    return stripPlaceholders(info, VOD_TEXT_FIELDS, VOD_RATING_FIELDS);
}

/** {@link stripXtreamVodInfoPlaceholders} for `get_series_info`. */
export function stripXtreamSerieInfoPlaceholders(
    info: XtreamSerieInfo
): XtreamSerieInfo {
    return stripPlaceholders(info, SERIE_TEXT_FIELDS, SERIE_RATING_FIELDS);
}

function stripPlaceholders<T extends { backdrop_path?: unknown }>(
    info: T,
    textFields: readonly (keyof T)[],
    ratingFields: readonly (keyof T)[]
): T {
    // Broken panels answer with `[]` or nothing; leave those to the callers'
    // existing sparse-response handling
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
        return info;
    }

    const stripped: Record<keyof T, unknown> = { ...info };
    const rewrite = (
        fields: readonly (keyof T)[],
        read: (value: unknown) => string | undefined
    ) => {
        for (const field of fields) {
            const value = info[field];
            if (typeof value === 'string') {
                stripped[field] = read(value) ?? '';
            }
        }
    };
    rewrite(textFields, readProviderText);
    rewrite(ratingFields, readProviderRating);

    if (Array.isArray(info.backdrop_path)) {
        stripped.backdrop_path = info.backdrop_path.filter(
            (url) => readProviderText(url) !== undefined
        );
    }

    return stripped as T;
}
