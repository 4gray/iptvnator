import { tmdbPosterUrl, tmdbProfileUrl } from './tmdb-config';
import { extractYear } from './tmdb-matcher';
import { TmdbPersonDetails } from './tmdb.types';

/**
 * View-friendly projection of a TMDB person + combined filmography, shared
 * by the portal actor pages.
 */

export interface ActorProfile {
    tmdbId: number;
    name: string;
    biography: string;
    birthday: string | null;
    deathday: string | null;
    placeOfBirth: string | null;
    photoUrl: string | null;
}

export interface ActorFilmographyCredit {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    year: number | null;
    posterUrl: string | null;
    character: string | null;
}

const MAX_FILMOGRAPHY_CREDITS = 80;

export function mapPersonProfile(person: TmdbPersonDetails): ActorProfile {
    return {
        tmdbId: person.id,
        name: person.name ?? '',
        biography: person.biography ?? '',
        birthday: person.birthday ?? null,
        deathday: person.deathday ?? null,
        placeOfBirth: person.place_of_birth ?? null,
        photoUrl: tmdbProfileUrl(person.profile_path),
    };
}

/**
 * Deduplicated acting credits, newest first (undated entries last),
 * capped at {@link MAX_FILMOGRAPHY_CREDITS}.
 */
export function mapPersonFilmography(
    person: TmdbPersonDetails
): ActorFilmographyCredit[] {
    const seen = new Set<string>();
    const credits: ActorFilmographyCredit[] = [];

    for (const credit of person.combined_credits?.cast ?? []) {
        const mediaType =
            credit.media_type === 'movie' || credit.media_type === 'tv'
                ? credit.media_type
                : null;
        const title = (credit.title ?? credit.name ?? '').trim();
        const key = `${mediaType}:${credit.id}`;
        if (!mediaType || !title || seen.has(key)) {
            continue;
        }
        seen.add(key);

        credits.push({
            tmdbId: credit.id,
            mediaType,
            title,
            year: extractYear(credit.release_date ?? credit.first_air_date),
            posterUrl: tmdbPosterUrl(credit.poster_path),
            character: credit.character?.trim() || null,
        });
    }

    return credits
        .sort((a, b) => (b.year ?? -1) - (a.year ?? -1))
        .slice(0, MAX_FILMOGRAPHY_CREDITS);
}
