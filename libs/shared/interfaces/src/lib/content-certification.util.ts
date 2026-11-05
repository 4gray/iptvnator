import { AGE_RATING_COUNTRY_CODES } from './age-rating-countries';
import type {
    AgeRatingDisplay,
    ContentCertification,
} from './content-certification';

const COUNTRIES = new Set(AGE_RATING_COUNTRY_CODES);
const UNKNOWN_VALUES = new Set(['n/a', '-', 'nr', 'unrated', 'not rated']);

export function normalizeAgeRatingCountry(input: unknown): string {
    const code = typeof input === 'string' ? input.trim().toUpperCase() : '';
    return COUNTRIES.has(code) ? code : 'auto';
}

/** Unlike viewer scores, an official zero is a meaningful classification. */
export function readCertificationValue(input: unknown): string | undefined {
    const value = typeof input === 'string' ? input.trim() : '';
    return value &&
        value.length <= 40 &&
        !UNKNOWN_VALUES.has(value.toLowerCase())
        ? value
        : undefined;
}

export { providerCertifications } from './provider-metadata.util';

export function selectAgeRating(
    certifications: readonly ContentCertification[] | undefined,
    countryCode: string
): AgeRatingDisplay | null {
    const country = normalizeAgeRatingCountry(countryCode);
    const entries = (
        Array.isArray(certifications) ? certifications : []
    ).filter(
        (entry): entry is ContentCertification =>
            !!entry &&
            !!readCertificationValue(entry.value) &&
            (entry.source === 'tmdb' || entry.source === 'provider') &&
            (!entry.countryCode ||
                normalizeAgeRatingCountry(entry.countryCode) !== 'auto')
    );
    const forCountry = (source: ContentCertification['source'], code: string) =>
        entries.filter(
            (entry) => entry.source === source && entry.countryCode === code
        );
    const foreignProvider = entries
        .filter((entry) => entry.source === 'provider' && !!entry.countryCode)
        .sort((a, b) =>
            (a.countryCode ?? '').localeCompare(b.countryCode ?? '', 'en')
        )[0];
    const groups = [
        forCountry('tmdb', country),
        forCountry('provider', country),
        forCountry('tmdb', 'US'),
        foreignProvider
            ? forCountry('provider', foreignProvider.countryCode ?? '')
            : [],
        entries.filter(
            (entry) => entry.source === 'provider' && !entry.countryCode
        ),
    ];
    const selected = groups.find((group) => group.length > 0);
    if (!selected) return null;
    const first = selected[0];
    const values = [
        ...new Set(selected.map((entry) => entry.value.trim())),
    ].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    return {
        values,
        countryCode: first.countryCode,
        source: first.source,
        isCountryFallback: !!first.countryCode && first.countryCode !== country,
        hasMultipleValues: values.length > 1,
    };
}
