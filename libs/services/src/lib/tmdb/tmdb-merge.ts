import {
    StalkerVodInfo,
    TmdbEnrichedCastMember,
    TmdbMediaType,
    TmdbRecommendation,
    XtreamSerieInfo,
    XtreamVodInfo,
} from '@iptvnator/shared/interfaces';
import { tmdbBackdropUrl, tmdbPosterUrl, tmdbProfileUrl } from './tmdb-config';
import { extractYear } from './tmdb-matcher';
import {
    TmdbCredits,
    TmdbDetails,
    TmdbMovieDetails,
    TmdbTvDetails,
} from './tmdb.types';

/**
 * Field-level merge of TMDB metadata into provider detail objects.
 * The provider stays authoritative for stream-related data; TMDB wins for
 * editorial fields (plot, cast, director, genres, rating, artwork) when it
 * has a value, otherwise the provider value is kept. Nothing is mutated.
 */

const MAX_CAST_NAMES = 10;

function topCast(credits: TmdbCredits | undefined) {
    return [...(credits?.cast ?? [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .slice(0, MAX_CAST_NAMES)
        .filter((member) => Boolean(member.name));
}

function castNames(credits: TmdbCredits | undefined): string {
    return topCast(credits)
        .map((member) => member.name)
        .join(', ');
}

/** Cast with profile photos for the avatar chips in detail views */
function enrichedCast(
    credits: TmdbCredits | undefined
): TmdbEnrichedCastMember[] {
    return topCast(credits).map((member) => ({
        name: member.name,
        ...(member.character ? { character: member.character } : {}),
        profileUrl: tmdbProfileUrl(member.profile_path),
        ...(member.id ? { tmdbPersonId: member.id } : {}),
    }));
}

function directorNames(credits: TmdbCredits | undefined): string {
    return (credits?.crew ?? [])
        .filter((member) => member.job === 'Director')
        .map((member) => member.name)
        .filter(Boolean)
        .join(', ');
}

function creatorNames(details: TmdbTvDetails): string {
    return (details.created_by ?? [])
        .map((creator) => creator.name)
        .filter(Boolean)
        .join(', ');
}

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

function tmdbRating(details: TmdbDetails): number | null {
    const { vote_average: average, vote_count: count } = details;
    return average && average > 0 && count && count > 0
        ? Math.round(average * 10) / 10
        : null;
}

/** TMDB backdrop first, then the provider's own entries (deduplicated) */
function mergedBackdrops(
    details: TmdbDetails,
    providerBackdrops: string[] | undefined
): string[] {
    const tmdbUrl = tmdbBackdropUrl(details.backdrop_path);
    const provider = (providerBackdrops ?? []).filter(Boolean);
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
    const tmdbCast = enrichedCast(details.credits);
    const trailer = pickTrailerKey(details);
    const recommendations = recommendationList(details);
    const cast = castNames(details.credits);
    const director = directorNames(details.credits);
    const genre = genreNames(details);
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
        releasedate: info.releasedate || (details.release_date ?? ''),
        country: info.country || country,
        movie_image: prefer(poster, info.movie_image),
        cover_big: prefer(poster, info.cover_big),
        backdrop_path: mergedBackdrops(details, info.backdrop_path),
        episode_run_time: info.episode_run_time || (details.runtime ?? 0),
        youtube_trailer: prefer(trailer, info.youtube_trailer),
        ...(tmdbCast.length > 0 ? { tmdb_cast: tmdbCast } : {}),
        ...(recommendations.length > 0
            ? { tmdb_recommendations: recommendations }
            : {}),
    };
}

export function mergeSerieInfoWithTmdb(
    info: XtreamSerieInfo,
    details: TmdbTvDetails
): XtreamSerieInfo {
    const tmdbCast = enrichedCast(details.credits);
    const trailer = pickTrailerKey(details);
    const recommendations = recommendationList(details);
    const cast = castNames(details.credits);
    const creators = creatorNames(details);
    const genre = genreNames(details);
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
        cover: prefer(poster, info.cover),
        backdrop_path: mergedBackdrops(details, info.backdrop_path),
        youtube_trailer: prefer(trailer, info.youtube_trailer),
        tmdb_id: details.id,
        ...(tmdbCast.length > 0 ? { tmdb_cast: tmdbCast } : {}),
        ...(recommendations.length > 0
            ? { tmdb_recommendations: recommendations }
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
    const tmdbCast = enrichedCast(details.credits);
    const trailer = pickTrailerKey(details);
    const recommendations = recommendationList(details);
    const cast = castNames(details.credits);
    const director =
        mediaType === 'movie'
            ? directorNames(details.credits)
            : creatorNames(details as TmdbTvDetails);
    const genre = genreNames(details);
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
        movie_image: prefer(poster, info.movie_image),
        rating_imdb:
            info.rating_imdb || (rating !== null ? String(rating) : ''),
        tmdb_id: details.id,
        ...(backdrop ? { tmdb_backdrop: backdrop } : {}),
        ...(trailer ? { tmdb_trailer: trailer } : {}),
        ...(tmdbCast.length > 0 ? { tmdb_cast: tmdbCast } : {}),
        ...(recommendations.length > 0
            ? { tmdb_recommendations: recommendations }
            : {}),
    };
}
