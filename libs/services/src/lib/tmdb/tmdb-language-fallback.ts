import { TmdbDetails, TmdbEpisode, TmdbSeasonDetails } from './tmdb.types';

/**
 * TMDB text fields (overview, episode overviews) are NOT auto-translated:
 * a Russian-only series returns empty overviews for `en-US`. When the
 * app-language payload has no text, we refetch once in the content's
 * `original_language` and fill only the missing text fields — everything
 * else (genres, credits, artwork) stays in the app language.
 */

function hasText(value: string | null | undefined): value is string {
    return Boolean(value?.trim());
}

/**
 * The original language to retry with, or null when the primary payload
 * already has an overview / is in that language anyway.
 */
export function detailsFallbackLanguage(
    details: TmdbDetails | null,
    currentLanguage: string
): string | null {
    const original = details?.original_language?.trim();
    if (!original || hasText(details?.overview)) {
        return null;
    }
    return currentLanguage.toLowerCase().startsWith(original.toLowerCase())
        ? null
        : original;
}

/** Fill the primary payload's empty overview from the fallback payload */
export function fillDetailsFromFallback(
    primary: TmdbDetails,
    fallback: TmdbDetails | null
): TmdbDetails {
    if (!fallback || hasText(primary.overview)) {
        return primary;
    }
    return hasText(fallback.overview)
        ? { ...primary, overview: fallback.overview }
        : primary;
}

/**
 * True when the season payload carries no usable text: no overviews at
 * all, or episodes whose names are ALL empty (partially translated
 * seasons keep localized overviews but lose the episode names).
 */
export function seasonNeedsTextFallback(season: TmdbSeasonDetails): boolean {
    const episodes = season.episodes ?? [];
    if (
        episodes.length > 0 &&
        !episodes.some((episode) => hasText(episode.name))
    ) {
        return true;
    }
    if (hasText(season.overview)) {
        return false;
    }
    return !episodes.some((episode) => hasText(episode.overview));
}

/**
 * Fill the season overview and per-episode names/overviews that are empty
 * in the primary (app-language) payload from the fallback payload.
 */
export function fillSeasonFromFallback(
    primary: TmdbSeasonDetails,
    fallback: TmdbSeasonDetails | null
): TmdbSeasonDetails {
    if (!fallback) {
        return primary;
    }

    const fallbackByNumber = new Map<number, TmdbEpisode>(
        (fallback.episodes ?? []).map((episode) => [
            episode.episode_number,
            episode,
        ])
    );

    const episodes = (primary.episodes ?? []).map((episode) => {
        const source = fallbackByNumber.get(episode.episode_number);
        if (!source) {
            return episode;
        }
        return {
            ...episode,
            name: hasText(episode.name) ? episode.name : source.name,
            overview: hasText(episode.overview)
                ? episode.overview
                : source.overview,
        };
    });

    return {
        ...primary,
        overview: hasText(primary.overview)
            ? primary.overview
            : fallback.overview,
        episodes,
    };
}
