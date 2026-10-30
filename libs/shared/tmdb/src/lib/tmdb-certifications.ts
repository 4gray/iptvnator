import { normalizeAgeRatingCountry, readCertificationValue } from '@iptvnator/shared/interfaces/age-rating';
import { type ContentCertification, type TmdbMediaType } from '@iptvnator/shared/interfaces';
import type {
    TmdbDetails,
    TmdbMovieDetails,
    TmdbTvDetails,
} from './tmdb.types';

/** All countries stay available so changing the display region needs no request. */
export function extractTmdbCertifications(
    details: TmdbDetails,
    mediaType: TmdbMediaType
): ContentCertification[] {
    const certifications: ContentCertification[] = [];
    if (mediaType === 'movie') {
        const countries = (details as TmdbMovieDetails).release_dates?.results;
        for (const country of Array.isArray(countries) ? countries : []) {
            const countryCode = normalizeAgeRatingCountry(country?.iso_3166_1);
            if (countryCode === 'auto') continue;
            const releases = country?.release_dates;
            for (const release of Array.isArray(releases) ? releases : []) {
                const value = readCertificationValue(release?.certification);
                if (!value) continue;
                const type = release?.type;
                certifications.push({
                    value,
                    countryCode,
                    source: 'tmdb',
                    ...(Number.isInteger(type) &&
                    type !== undefined &&
                    type >= 1 &&
                    type <= 6
                        ? {
                              releaseType:
                                  type as ContentCertification['releaseType'],
                          }
                        : {}),
                });
            }
        }
    } else {
        const ratings = (details as TmdbTvDetails).content_ratings?.results;
        for (const rating of Array.isArray(ratings) ? ratings : []) {
            const countryCode = normalizeAgeRatingCountry(rating?.iso_3166_1);
            const value = readCertificationValue(rating?.rating);
            if (countryCode !== 'auto' && value)
                certifications.push({ value, countryCode, source: 'tmdb' });
        }
    }
    const seen = new Set<string>();
    return certifications.filter((entry) => {
        const key = JSON.stringify([
            entry.countryCode,
            entry.value,
            entry.releaseType,
        ]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
