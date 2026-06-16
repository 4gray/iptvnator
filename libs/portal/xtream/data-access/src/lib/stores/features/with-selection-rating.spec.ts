import { filterByMinRating, getNumericRating } from './with-selection.feature';

type RatingItem = Parameters<typeof getNumericRating>[0];

const item = (fields: Record<string, unknown>): RatingItem =>
    fields as RatingItem;

describe('with-selection rating helpers', () => {
    describe('getNumericRating', () => {
        it('prefers rating_imdb over the generic rating', () => {
            expect(
                getNumericRating(item({ rating_imdb: '7.4', rating: '6.5' }))
            ).toBe(7.4);
        });

        it('falls back to the generic rating and parses numbers + strings', () => {
            expect(getNumericRating(item({ rating: '6.5' }))).toBe(6.5);
            expect(getNumericRating(item({ rating: 8 }))).toBe(8);
        });

        it('reads the nested info object when the list shape lacks a rating', () => {
            expect(getNumericRating(item({ info: { rating: '5.5' } }))).toBe(
                5.5
            );
        });

        it('returns null for missing or unparseable ratings', () => {
            expect(getNumericRating(item({ rating: 'N/A' }))).toBeNull();
            expect(getNumericRating(item({ rating: '' }))).toBeNull();
            expect(getNumericRating(item({}))).toBeNull();
        });
    });

    describe('filterByMinRating', () => {
        const items = [
            item({ name: 'A', rating: '8.5' }),
            item({ name: 'B', rating: '6.0' }),
            item({ name: 'C' }),
        ];

        it('keeps only items at or above the threshold and drops unrated ones', () => {
            expect(
                filterByMinRating(items, 7).map((i) => (i as { name: string }).name)
            ).toEqual(['A']);
        });

        it('is inclusive of the exact threshold value', () => {
            expect(
                filterByMinRating(items, 6).map(
                    (i) => (i as { name: string }).name
                )
            ).toEqual(['A', 'B']);
        });

        it('returns the original array when the threshold is null or non-positive', () => {
            expect(filterByMinRating(items, null)).toBe(items);
            expect(filterByMinRating(items, 0)).toBe(items);
        });
    });
});
