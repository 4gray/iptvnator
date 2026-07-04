import { TmdbRecommendation } from '@iptvnator/shared/interfaces';
import {
    buildCatalogTitleIndex,
    lookupCatalogTitle,
    matchRecommendationsToCatalog,
} from './tmdb-similar.util';

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

describe('two-tier year handling', () => {
    const rec = (
        tmdbId: number,
        title: string,
        year: number | null = null
    ): TmdbRecommendation => ({ tmdbId, title, year, posterUrl: null });

    const catalog = [
        { stream_id: 1, name: 'Blade Runner 2049', category_id: '9' },
        { stream_id: 2, name: 'The Matrix 1999', category_id: '9' },
    ];

    it('matches a title-year recommendation on the exact tier', () => {
        const matched = matchRecommendationsToCatalog(
            [rec(335984, 'Blade Runner 2049', 2017)],
            catalog
        );
        expect(matched.map((m) => m.id)).toEqual([1]);
    });

    it('rejects a year-incompatible base-tier match', () => {
        // "Blade Runner" (1982) must NOT claim the catalog's "Blade Runner 2049"
        const matched = matchRecommendationsToCatalog(
            [rec(78, 'Blade Runner', 1982)],
            catalog
        );
        expect(matched).toEqual([]);
    });

    it('accepts a year-compatible base-tier match', () => {
        const matched = matchRecommendationsToCatalog(
            [rec(603, 'The Matrix', 1999)],
            catalog
        );
        expect(matched.map((m) => m.id)).toEqual([2]);
    });
});

describe('buildCatalogTitleIndex / lookupCatalogTitle', () => {
    const index = buildCatalogTitleIndex([
        { stream_id: 1, name: 'Blade Runner 2049', category_id: '9' },
        { stream_id: 2, name: 'The Matrix 1999', category_id: '9' },
        { stream_id: 3, name: 'Heat', category_id: '9' },
    ]);

    it('resolves exact titles including title-years', () => {
        expect(lookupCatalogTitle(index, 'Blade Runner 2049', 2017)?.id).toBe(1);
        expect(lookupCatalogTitle(index, 'Heat', 1995)?.id).toBe(3);
    });

    it('resolves year-tagged provider titles when years agree', () => {
        expect(lookupCatalogTitle(index, 'The Matrix', 1999)?.id).toBe(2);
    });

    it('rejects contradicting years on the stripped tier', () => {
        expect(lookupCatalogTitle(index, 'Blade Runner', 1982)).toBeNull();
    });

    it('is lenient when the credit year is unknown', () => {
        expect(lookupCatalogTitle(index, 'The Matrix', null)?.id).toBe(2);
    });
});
