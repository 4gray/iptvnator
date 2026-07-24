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
    /** Character (acting credits) or job like "Director" (crew credits) */
    character: string | null;
}

const MAX_FILMOGRAPHY_CREDITS = 80;
/** Crew jobs worth showing on the person page (directors, TV creators) */
const FILMOGRAPHY_CREW_JOBS = new Set(['Director', 'Creator']);

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
 * Deduplicated acting + directing credits in one merged list, newest
 * first (undated entries last), capped at {@link MAX_FILMOGRAPHY_CREDITS}.
 * Acting credits win the dedup so "Actor — Character" survives when a
 * person both starred in and directed the same title; directing-only
 * titles show the job ("Director") in the character slot.
 */
export function mapPersonFilmography(
    person: TmdbPersonDetails
): ActorFilmographyCredit[] {
    const seen = new Set<string>();
    const credits: ActorFilmographyCredit[] = [];

    const castCredits = person.combined_credits?.cast ?? [];
    const crewCredits = (person.combined_credits?.crew ?? []).filter(
        (credit) => credit.job && FILMOGRAPHY_CREW_JOBS.has(credit.job)
    );

    for (const credit of [...castCredits, ...crewCredits]) {
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
            character: credit.character?.trim() || credit.job?.trim() || null,
        });
    }

    return credits
        .sort((a, b) => (b.year ?? -1) - (a.year ?? -1))
        .slice(0, MAX_FILMOGRAPHY_CREDITS);
}
