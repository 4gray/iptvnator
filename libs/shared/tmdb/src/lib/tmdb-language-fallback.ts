import { TmdbDetails, TmdbEpisode, TmdbSeasonDetails } from './tmdb.types';

/**
 * TMDB filters BOTH text (overview, episode overviews) AND videos by the
 * `language` param: a Russian-only title returns an empty overview and no
 * trailer for `en-US`, because its trailer is tagged `iso_639_1=ru`. When
 * the app-language payload is missing text or a trailer, we refetch once
 * in the content's `original_language` and fill only the missing fields —
 * everything else (genres, credits, artwork) stays in the app language.
 */

function hasText(value: string | null | undefined): value is string {
    return Boolean(value?.trim());
}

/** True when the payload carries a usable YouTube trailer/teaser */
function hasYoutubeTrailer(details: TmdbDetails | null): boolean {
    return (details?.videos?.results ?? []).some(
        (video) =>
            video.site === 'YouTube' &&
            Boolean(video.key) &&
            (video.type === 'Trailer' || video.type === 'Teaser')
    );
}

/**
 * The original language to retry with, or null when the primary payload
 * already has both an overview and a trailer / is in that language anyway.
 */
export function detailsFallbackLanguage(
    details: TmdbDetails | null,
    currentLanguage: string
): string | null {
    const original = details?.original_language?.trim();
    if (!original) {
        return null;
    }
    // Trailers, like overviews, are language-filtered by TMDB — retry when
    // either is missing in the app language.
    if (hasText(details?.overview) && hasYoutubeTrailer(details)) {
        return null;
    }
    return currentLanguage.toLowerCase().startsWith(original.toLowerCase())
        ? null
        : original;
}

/**
 * Fill the primary payload's missing overview and/or trailer from the
 * fallback (original-language) payload — each field independently, so a
 * present app-language overview is kept even while the trailer is filled.
 */
export function fillDetailsFromFallback(
    primary: TmdbDetails,
    fallback: TmdbDetails | null
): TmdbDetails {
    if (!fallback) {
        return primary;
    }

    let result = primary;
    if (!hasText(primary.overview) && hasText(fallback.overview)) {
        result = { ...result, overview: fallback.overview };
    }
    if (!hasYoutubeTrailer(primary) && hasYoutubeTrailer(fallback)) {
        result = { ...result, videos: fallback.videos };
    }
    return result;
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
