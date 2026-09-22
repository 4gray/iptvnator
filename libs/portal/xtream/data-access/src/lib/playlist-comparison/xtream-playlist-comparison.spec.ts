import { XtreamContent } from '@iptvnator/services';
import {
    compareXtreamCatalogues,
    normalizeComparisonText,
} from './xtream-playlist-comparison';

function content(
    id: number,
    title: string,
    values: Partial<XtreamContent> = {}
): XtreamContent {
    return {
        id,
        category_id: 1,
        title,
        rating: '',
        added: '',
        poster_url: '',
        xtream_id: id,
        type: 'movie',
        ...values,
    };
}

describe('Xtream playlist comparison', () => {
    it('folds case, accents, whitespace and punctuation without fuzzy matching', () => {
        expect(normalizeComparisonText('  Léon:  The  Professional! ')).toBe(
            'leon the professional'
        );
        expect(normalizeComparisonText('Alien')).not.toBe(
            normalizeComparisonText('Aliens')
        );
    });

    it('matches movies by TMDB id before titles', () => {
        const result = compareXtreamCatalogues(
            [content(1, 'Provider title', { tmdb_id: 42 })],
            [content(2, 'Other title', { tmdb_id: 42 })],
            'movie'
        );
        expect(result.common).toHaveLength(1);
        expect(result.common[0].reason).toBe('tmdb');
    });

    it('matches title and stated year, but not different years', () => {
        const same = compareXtreamCatalogues(
            [content(1, 'Amélie', { release_year: 2001 })],
            [content(2, 'amelie!', { release_year: 2001 })],
            'movie'
        );
        const different = compareXtreamCatalogues(
            [content(1, 'Dune', { release_year: 1984 })],
            [content(2, 'Dune', { release_year: 2021 })],
            'movie'
        );
        expect(same.common[0].reason).toBe('title-year');
        expect(different.common).toHaveLength(0);
    });

    it('never falls back when both TMDB ids contradict', () => {
        const result = compareXtreamCatalogues(
            [content(1, 'Dune', { tmdb_id: 1, release_year: 2021 })],
            [content(2, 'Dune', { tmdb_id: 2, release_year: 2021 })],
            'movie'
        );
        expect(result.common).toHaveLength(0);
        expect(result.onlyA).toHaveLength(1);
        expect(result.onlyB).toHaveLength(1);
    });

    it('allows a single TMDB id to fall back only through title and year', () => {
        const byYear = compareXtreamCatalogues(
            [content(1, 'Arrival', { tmdb_id: 329865, release_year: 2016 })],
            [content(2, 'arrival', { release_year: 2016 })],
            'movie'
        );
        const titleOnly = compareXtreamCatalogues(
            [content(1, 'Arrival', { tmdb_id: 329865 })],
            [content(2, 'arrival')],
            'movie'
        );
        expect(byYear.common[0].reason).toBe('title-year');
        expect(titleOnly.common).toHaveLength(0);
    });

    it('uses a unique title fallback and preserves duplicate titles as ambiguous', () => {
        const unique = compareXtreamCatalogues(
            [content(1, 'Arrival')],
            [content(2, 'arrival')],
            'movie'
        );
        const duplicate = compareXtreamCatalogues(
            [content(1, 'The Office'), content(2, 'The Office')],
            [content(3, 'The Office')],
            'series'
        );
        expect(unique.common[0].reason).toBe('title');
        expect(duplicate.ambiguous).toHaveLength(1);
    });

    it('matches live channels by EPG id, then by normalized name', () => {
        const epg = compareXtreamCatalogues(
            [content(1, 'News', { epg_channel_id: 'news.uk' })],
            [content(2, 'Different name', { epg_channel_id: 'news.uk' })],
            'live'
        );
        const name = compareXtreamCatalogues(
            [content(1, 'Télé Québec')],
            [content(2, 'tele-quebec')],
            'live'
        );
        expect(epg.common[0].reason).toBe('epg');
        expect(name.common[0].reason).toBe('title');
    });

    it('keeps empty catalogues and no matches distinct', () => {
        const empty = compareXtreamCatalogues([], [], 'movie');
        const separate = compareXtreamCatalogues(
            [content(1, 'A')],
            [content(2, 'B')],
            'movie'
        );
        expect(empty.totalA).toBe(0);
        expect(empty.totalB).toBe(0);
        expect(separate.onlyA).toHaveLength(1);
        expect(separate.onlyB).toHaveLength(1);
    });
});
