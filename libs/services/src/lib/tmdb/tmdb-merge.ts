import {
    normalizeSeriesStatus,
    StalkerVodInfo,
    TmdbCountryFacet,
    TmdbGenreFacet,
    TmdbMediaType,
    TmdbRecommendation,
    XtreamSerieInfo,
    XtreamVodInfo,
} from '@iptvnator/shared/interfaces';
import { tmdbBackdropUrl, tmdbPosterUrl } from './tmdb-config';
import {
    castNames,
    creatorNames,
    directorNames,
    enrichedCast,
    enrichedCreators,
    enrichedDirectors,
    limitCast,
    topCast,
    unifiedTvCast,
} from './tmdb-credits';
import { extractYear } from './tmdb-matcher';
import {
    TmdbDetails,
    TmdbMovieDetails,
    TmdbTvDetails,
} from './tmdb.types';

/**
 * Field-level merge of TMDB metadata into provider detail objects.
 * The provider stays authoritative for stream-related data; TMDB wins for
 * editorial fields (plot, cast, director, genres, rating, artwork) when it
 * has a value, otherwise the provider value is kept. Nothing is mutated.
 * People (cast, directors, creators) are extracted in `tmdb-credits.ts`.
 */

const MAX_RECOMMENDATIONS = 12;

/** Best YouTube trailer key: official trailer > any trailer > teaser */
function pickTrailerKey(details: TmdbDetails): string {
    const videos = (details.videos?.results ?? []).filter(
        (video) => video.site === 'YouTube' && Boolean(video.key)
    );
    const best =
        videos.find((video) => video.type === 'Trailer' && video.official) ??
        videos.find((video) => video.type === 'Trailer') ??
        videos.find((video) => video.type === 'Teaser');
    return best?.key ?? '';
}

function recommendationList(details: TmdbDetails): TmdbRecommendation[] {
    return (details.recommendations?.results ?? [])
        .slice(0, MAX_RECOMMENDATIONS)
        .map((result) => ({
            tmdbId: result.id,
            title: (result.title ?? result.name ?? '').trim(),
            year: extractYear(result.release_date ?? result.first_air_date),
            posterUrl: tmdbPosterUrl(result.poster_path),
        }))
        .filter((recommendation) => recommendation.title !== '');
}

function genreNames(details: TmdbDetails): string {
    return (details.genres ?? [])
        .map((genre) => genre.name)
        .filter(Boolean)
        .join(', ');
}

/** Structured genres for clickable Discover chips */
function genreFacets(details: TmdbDetails): TmdbGenreFacet[] {
    return (details.genres ?? [])
        .filter((genre) => Number.isInteger(genre.id) && !!genre.name?.trim())
        .map((genre) => ({ id: genre.id, name: genre.name }));
}

/**
 * Structured countries for clickable Discover chips.
 *
 * Built from `origin_country`, never from the fuller
 * `production_countries`: the Discover page filters by
 * `with_origin_country`, so a co-production's other countries would
 * promise "titles from here" and deliver a different set. Names come
 * from `production_countries` (the only place TMDB states them), and a
 * code it does not name is dropped rather than rendered as a bare "FR".
 */
function countryFacets(details: TmdbDetails): TmdbCountryFacet[] {
    const namesByCode = new Map(
        (details.production_countries ?? [])
            .filter((entry) => !!entry.iso_3166_1 && !!entry.name)
            .map((entry) => [entry.iso_3166_1 as string, entry.name as string])
    );
    return (details.origin_country ?? [])
        .filter((code) => namesByCode.has(code))
        .map((code) => ({ code, name: namesByCode.get(code) as string }));
}

function tmdbRating(details: TmdbDetails): number | null {
    const { vote_average: average, vote_count: count } = details;
    return average && average > 0 && count && count > 0
        ? Math.round(average * 10) / 10
        : null;
}

/** TMDB backdrop first, then the provider's own entries (deduplicated) */
function mergedBackdrops(
    details: TmdbDetails,
    // Some panels send backdrop_path as a plain string despite the typing
    providerBackdrops: string[] | string | undefined
): string[] {
    const tmdbUrl = tmdbBackdropUrl(details.backdrop_path);
    const provider = (
        Array.isArray(providerBackdrops)
            ? providerBackdrops
            : [providerBackdrops]
    ).filter((value): value is string => typeof value === 'string' && !!value);
    return tmdbUrl
        ? [tmdbUrl, ...provider.filter((url) => url !== tmdbUrl)]
        : provider;
}

function prefer(tmdbValue: string | null | undefined, providerValue: string) {
    return tmdbValue?.trim() ? tmdbValue : providerValue;
}

export function mergeVodInfoWithTmdb(
    info: XtreamVodInfo,
    details: TmdbMovieDetails
): XtreamVodInfo {
    const movieCast = topCast(details.credits);
    const tmdbCast = enrichedCast(movieCast);
    const tmdbDirectors = enrichedDirectors(details.credits);
    const trailer = pickTrailerKey(details);
    const recommendations = recommendationList(details);
    const cast = castNames(movieCast);
    const director = directorNames(details.credits);
    const genre = genreNames(details);
    const tmdbGenres = genreFacets(details);
    const tmdbCountries = countryFacets(details);
    const rating = tmdbRating(details);
    const poster = tmdbPosterUrl(details.poster_path);
    const country = (details.production_countries ?? [])
        .map((entry) => entry.name)
        .filter(Boolean)
        .join(', ');

    return {
        ...info,
        tmdb_id: details.id,
        plot: prefer(details.overview, info.plot),
        description: prefer(details.overview, info.description),
        cast: prefer(cast, info.cast),
        actors: prefer(cast, info.actors),
        director: prefer(director, info.director),
        genre: prefer(genre, info.genre),
        rating: rating ?? info.rating,
        // The VOD detail badge renders rating_imdb — fill it when the
        // provider left it empty so a TMDB-only score is actually shown
        rating_imdb:
            info.rating_imdb || (rating !== null ? String(rating) : ''),
        releasedate: info.releasedate || (details.release_date ?? ''),
        ...(info.releasedate ? {} : { tmdb_supplied_release_date: true }),
        country: info.country || country,
        movie_image: prefer(poster, info.movie_image),
        cover_big: prefer(poster, info.cover_big),
        backdrop_path: mergedBackdrops(details, info.backdrop_path),
        episode_run_time: info.episode_run_time || (details.runtime ?? 0),
        youtube_trailer: prefer(trailer, info.youtube_trailer),
        ...(tmdbDirectors.length > 0 ? { tmdb_directors: tmdbDirectors } : {}),
        ...(tmdbCast.length > 0 ? { tmdb_cast: tmdbCast } : {}),
        ...(recommendations.length > 0
            ? { tmdb_recommendations: recommendations }
            : {}),
        ...(tmdbGenres.length > 0 ? { tmdb_genres: tmdbGenres } : {}),
        ...(tmdbCountries.length > 0
            ? { tmdb_countries: tmdbCountries }
            : {}),
    };
}

export function mergeSerieInfoWithTmdb(
    info: XtreamSerieInfo,
    details: TmdbTvDetails
): XtreamSerieInfo {
    const seriesCast = limitCast(unifiedTvCast(details));
    const tmdbCast = enrichedCast(seriesCast);
    const tmdbDirectors = enrichedCreators(details);
    const status = normalizeSeriesStatus(details.status);
    const trailer = pickTrailerKey(details);
    const recommendations = recommendationList(details);
    const cast = castNames(seriesCast);
    const creators = creatorNames(details);
    const genre = genreNames(details);
    const tmdbGenres = genreFacets(details);
    const tmdbCountries = countryFacets(details);
    const rating = tmdbRating(details);
    const poster = tmdbPosterUrl(details.poster_path);

    return {
        ...info,
        plot: prefer(details.overview, info.plot),
        cast: prefer(cast, info.cast),
        director: prefer(creators, info.director),
        genre: prefer(genre, info.genre),
        rating: rating !== null ? String(rating) : info.rating,
        rating_5based:
            rating !== null ? Math.round(rating * 5) / 10 : info.rating_5based,
        releaseDate: info.releaseDate || (details.first_air_date ?? ''),
        ...(info.releaseDate ? {} : { tmdb_supplied_release_date: true }),
        cover: prefer(poster, info.cover),
        backdrop_path: mergedBackdrops(details, info.backdrop_path),
        youtube_trailer: prefer(trailer, info.youtube_trailer),
        tmdb_id: details.id,
        ...(status ? { tmdb_status: status } : {}),
        ...(tmdbDirectors.length > 0 ? { tmdb_directors: tmdbDirectors } : {}),
        ...(tmdbCast.length > 0 ? { tmdb_cast: tmdbCast } : {}),
        ...(recommendations.length > 0
            ? { tmdb_recommendations: recommendations }
            : {}),
        ...(tmdbGenres.length > 0 ? { tmdb_genres: tmdbGenres } : {}),
        ...(tmdbCountries.length > 0
            ? { tmdb_countries: tmdbCountries }
            : {}),
    };
}

/**
 * Merge for Stalker portal detail objects. One function covers movies and
 * series — both render from the same `StalkerVodInfo` shape. The TMDB
 * rating only FILLS `rating_imdb` (the UI labels it as IMDb, so a present
 * provider value must not be overwritten with a TMDB score).
 */
export function mergeStalkerInfoWithTmdb(
    info: StalkerVodInfo,
    details: TmdbMovieDetails | TmdbTvDetails,
    mediaType: TmdbMediaType
): StalkerVodInfo {
    const selectedCast =
        mediaType === 'movie'
            ? topCast(details.credits)
            : limitCast(unifiedTvCast(details as TmdbTvDetails));
    const tmdbCast = enrichedCast(selectedCast);
    const tmdbDirectors =
        mediaType === 'movie'
            ? enrichedDirectors(details.credits)
            : enrichedCreators(details as TmdbTvDetails);
    const status =
        mediaType === 'tv'
            ? normalizeSeriesStatus((details as TmdbTvDetails).status)
            : null;
    const trailer = pickTrailerKey(details);
    const recommendations = recommendationList(details);
    const cast = castNames(selectedCast);
    const director =
        mediaType === 'movie'
            ? directorNames(details.credits)
            : creatorNames(details as TmdbTvDetails);
    const genre = genreNames(details);
    const tmdbGenres = genreFacets(details);
    const tmdbCountries = countryFacets(details);
    const rating = tmdbRating(details);
    const poster = tmdbPosterUrl(details.poster_path);
    const backdrop = tmdbBackdropUrl(details.backdrop_path);
    const releaseDate =
        mediaType === 'movie'
            ? (details as TmdbMovieDetails).release_date
            : (details as TmdbTvDetails).first_air_date;

    return {
        ...info,
        description: prefer(details.overview, info.description),
        actors: prefer(cast, info.actors),
        director: prefer(director, info.director),
        genre: prefer(genre, info.genre),
        releasedate: info.releasedate || (releaseDate ?? ''),
        ...(info.releasedate ? {} : { tmdb_supplied_release_date: true }),
        movie_image: prefer(poster, info.movie_image),
        rating_imdb:
            info.rating_imdb || (rating !== null ? String(rating) : ''),
        tmdb_id: details.id,
        ...(status ? { tmdb_status: status } : {}),
        ...(backdrop ? { tmdb_backdrop: backdrop } : {}),
        ...(trailer ? { tmdb_trailer: trailer } : {}),
        ...(tmdbDirectors.length > 0 ? { tmdb_directors: tmdbDirectors } : {}),
        ...(tmdbCast.length > 0 ? { tmdb_cast: tmdbCast } : {}),
        ...(recommendations.length > 0
            ? { tmdb_recommendations: recommendations }
            : {}),
        ...(tmdbGenres.length > 0 ? { tmdb_genres: tmdbGenres } : {}),
        ...(tmdbCountries.length > 0
            ? { tmdb_countries: tmdbCountries }
            : {}),
        // Lets the shared detail view route Discover clicks to the media
        // type this item actually matched as (embedded-VOD series → tv)
        tmdb_media_type: mediaType,
    };
}
