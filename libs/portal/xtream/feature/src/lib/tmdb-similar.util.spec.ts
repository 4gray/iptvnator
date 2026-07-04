import { TmdbRecommendation } from '@iptvnator/shared/interfaces';
import { matchRecommendationsToCatalog } from './tmdb-similar.util';

describe('matchRecommendationsToCatalog', () => {
    const rec = (
        tmdbId: number,
        title: string,
        posterUrl: string | null = null
    ): TmdbRecommendation => ({ tmdbId, title, year: null, posterUrl });

    const catalog = [
        {
            stream_id: 11,
            name: 'The Matrix Reloaded',
            category_id: '5',
            stream_icon: 'http://provider/reloaded.jpg',
        },
        {
            xtream_id: 22,
            title: 'EN - Inception (2010) 4K',
            category_id: 7,
            poster_url: 'http://provider/inception.jpg',
        },
        { stream_id: 33, name: 'Unrelated Movie', category_id: '5' },
    ];

    it('matches recommendations by normalized title', () => {
        const matched = matchRecommendationsToCatalog(
            [rec(603, 'The Matrix Reloaded'), rec(27205, 'Inception')],
            catalog
        );

        expect(matched).toEqual([
            {
                id: 11,
                categoryId: '5',
                title: 'The Matrix Reloaded',
                posterUrl: 'http://provider/reloaded.jpg',
            },
            {
                id: 22,
                categoryId: '7',
                title: 'EN - Inception (2010) 4K',
                posterUrl: 'http://provider/inception.jpg',
            },
        ]);
    });

    it('prefers the TMDB poster when available', () => {
        const matched = matchRecommendationsToCatalog(
            [rec(603, 'The Matrix Reloaded', 'https://tmdb/poster.jpg')],
            catalog
        );
        expect(matched[0].posterUrl).toBe('https://tmdb/poster.jpg');
    });

    it('drops recommendations without a catalog hit', () => {
        const matched = matchRecommendationsToCatalog(
            [rec(1, 'Movie Not In Catalog')],
            catalog
        );
        expect(matched).toEqual([]);
    });

    it('excludes the currently open item', () => {
        const matched = matchRecommendationsToCatalog(
            [rec(603, 'The Matrix Reloaded')],
            catalog,
            { excludeId: 11 }
        );
        expect(matched).toEqual([]);
    });

    it('respects the limit', () => {
        const matched = matchRecommendationsToCatalog(
            [rec(603, 'The Matrix Reloaded'), rec(27205, 'Inception')],
            catalog,
            { limit: 1 }
        );
        expect(matched).toHaveLength(1);
    });

    it('handles empty inputs', () => {
        expect(matchRecommendationsToCatalog(undefined, catalog)).toEqual([]);
        expect(
            matchRecommendationsToCatalog([rec(1, 'Anything')], [])
        ).toEqual([]);
    });
});
