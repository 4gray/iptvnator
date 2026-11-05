import { AGE_RATING_COUNTRY_CODES } from './age-rating-countries';
import type { ContentCertification } from './content-certification';
import {
    normalizeAgeRatingCountry,
    providerCertifications,
    selectAgeRating,
} from './content-certification.util';

const tmdb = (value: string, countryCode: string): ContentCertification => ({
    value,
    countryCode,
    source: 'tmdb',
});
const provider = (
    value: string,
    countryCode?: string
): ContentCertification => ({
    value,
    countryCode,
    source: 'provider',
});

describe('age classification country', () => {
    it('validates all ISO countries and preserves explicit selections', () => {
        expect(AGE_RATING_COUNTRY_CODES).toHaveLength(249);
        expect(new Set(AGE_RATING_COUNTRY_CODES).size).toBe(249);
        expect(normalizeAgeRatingCountry(' de ')).toBe('DE');
        for (const value of [
            null,
            undefined,
            '',
            'auto',
            'ZZ',
            'UK',
            'usa',
            12,
        ]) {
            expect(normalizeAgeRatingCountry(value)).toBe('auto');
        }
    });
});

describe('provider classifications', () => {
    it('preserves classifications rather than interpreting viewer scores', () => {
        expect(providerCertifications('12+', 'R')).toEqual([
            provider('R', 'US'),
            provider('12+'),
        ]);
        expect(providerCertifications('0+', 'pg-13')).toEqual([
            provider('PG-13', 'US'),
            provider('0+'),
        ]);
    });
    it.each(['0', 0, '8.5', 'N/A', '-', 'NR', 'Unrated', '22+', {}, null])(
        'ignores ambiguous age %p',
        (age) => {
            expect(providerCertifications(age, 'Unrated')).toEqual([]);
        }
    );
});

describe('classification selection', () => {
    const entries = [
        provider('18+'),
        provider('R', 'US'),
        tmdb('PG-13', 'US'),
        tmdb('12', 'DE'),
    ];
    it('prefers selected-country TMDB over provider and foreign ratings', () => {
        expect(
            selectAgeRating([...entries, provider('16', 'DE')], 'DE')
        ).toEqual({
            values: ['12'],
            countryCode: 'DE',
            source: 'tmdb',
            isCountryFallback: false,
            hasMultipleValues: false,
        });
    });
    it('prefers a local provider over the US TMDB fallback', () => {
        expect(
            selectAgeRating([provider('16', 'DE'), tmdb('R', 'US')], 'DE')
                ?.source
        ).toBe('provider');
    });
    it('marks a US fallback and never chooses an arbitrary foreign TMDB rating', () => {
        expect(selectAgeRating(entries, 'FR')).toMatchObject({
            values: ['PG-13'],
            countryCode: 'US',
            isCountryFallback: true,
        });
        expect(selectAgeRating([tmdb('12', 'DE')], 'FR')).toBeNull();
    });
    it('preserves genuine zero and stably deduplicates conflicting release classifications', () => {
        const values = [
            tmdb('16', 'DE'),
            tmdb('0', 'DE'),
            tmdb('12', 'DE'),
            tmdb('16', 'DE'),
        ];
        expect(selectAgeRating(values, 'DE')).toMatchObject({
            values: ['0', '12', '16'],
            hasMultipleValues: true,
        });
        expect(selectAgeRating([...values].reverse(), 'DE')).toEqual(
            selectAgeRating(values, 'DE')
        );
    });
    it('labels a provider fallback without inventing its country', () => {
        expect(selectAgeRating([provider('12+')], 'DE')).toEqual({
            values: ['12+'],
            countryCode: undefined,
            source: 'provider',
            isCountryFallback: false,
            hasMultipleValues: false,
        });
    });
    it('does not mistake missing data or unrated classifications for unrestricted viewing', () => {
        expect(selectAgeRating(undefined, 'DE')).toBeNull();
        expect(
            selectAgeRating(
                [tmdb('NR', 'US'), tmdb('', 'DE'), tmdb('Unrated', 'DE')],
                'DE'
            )
        ).toBeNull();
    });
});
