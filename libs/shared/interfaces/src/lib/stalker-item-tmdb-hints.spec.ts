import { buildPlaylistRecentItems } from './playlist-recently-viewed.utils';
import type { PlaylistMeta } from './playlist-meta.type';
import { extractStalkerItemTmdbHints } from './stalker-item-tmdb-hints';
import { extractStalkerItemType } from './stalker-item.normalizer';

/**
 * The shape a Stalker recently-viewed entry has after the detail view
 * enriched it: an embedded-VOD ("vclub") series, so `series` is populated
 * while the category stays VOD.
 */
const enrichedEntry = {
    id: '17573',
    cmd: '/media/17573.mpg',
    series: [1, 2, 3],
    category_id: '7',
    cover: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    title: 'Холод (10 серий)',
    added_at: '2026-07-20T18:19:18.979Z',
    info: {
        name: 'Холод (10 серий)',
        o_name: 'Kholod',
        releasedate: '2026',
        tmdb_id: 318354,
        tmdb_backdrop: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    },
};

describe('extractStalkerItemTmdbHints', () => {
    it('reads the facts the detail view merged into the stored entry', () => {
        expect(extractStalkerItemTmdbHints(enrichedEntry)).toEqual({
            backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
            mediaType: 'tv',
            originalTitle: 'Kholod',
            tmdbId: 318354,
            title: 'Холод (10 серий)',
            year: 2026,
        });
    });

    it('types embedded-VOD series as tv even though the activity row is a movie', () => {
        // The routing type must stay 'movie' (these live in the VOD section)
        // while the TMDB lookup has to run against /tv — the two answers
        // diverge on purpose.
        expect(extractStalkerItemType(enrichedEntry)).toBe('movie');
        expect(extractStalkerItemTmdbHints(enrichedEntry).mediaType).toBe('tv');
    });

    it('types regular series-category items as tv', () => {
        expect(
            extractStalkerItemTmdbHints({
                id: '9',
                category_id: 'series',
                info: { name: 'The Boys' },
            }).mediaType
        ).toBe('tv');
    });

    it('types a plain VOD item as movie', () => {
        expect(
            extractStalkerItemTmdbHints({
                id: '9',
                category_id: 'vod',
                info: { name: 'Heat', releasedate: '1995-12-15' },
            })
        ).toEqual({
            backdropUrl: undefined,
            mediaType: 'movie',
            originalTitle: undefined,
            tmdbId: undefined,
            title: 'Heat',
            year: 1995,
        });
    });

    it('falls back to a year inside the title when there is no release date', () => {
        expect(
            extractStalkerItemTmdbHints({
                info: { name: 'Dune (2021)' },
            }).year
        ).toBe(2021);
    });

    it('reports no title when the entry carries no info block', () => {
        // Callers keep their own display title instead of searching for a
        // placeholder such as "Unknown".
        expect(extractStalkerItemTmdbHints({ id: '1', title: 'X' })).toEqual({
            backdropUrl: undefined,
            mediaType: 'movie',
            originalTitle: undefined,
            tmdbId: undefined,
            title: undefined,
            year: null,
        });
    });

    it('ignores blank and non-positive-integer values', () => {
        expect(
            extractStalkerItemTmdbHints({
                info: {
                    name: 'X',
                    o_name: '   ',
                    tmdb_backdrop: '',
                    tmdb_id: 'not-a-number',
                },
            })
        ).toEqual({
            backdropUrl: undefined,
            mediaType: 'movie',
            originalTitle: undefined,
            tmdbId: undefined,
            title: 'X',
            year: null,
        });
    });

    it('tolerates a missing item', () => {
        expect(extractStalkerItemTmdbHints(undefined).mediaType).toBe('movie');
        expect(extractStalkerItemTmdbHints(null).year).toBeNull();
    });
});

describe('buildPlaylistRecentItems (stalker backdrops)', () => {
    const labels = { stalker: 'Stalker', m3u: 'M3U' };

    function recentItemsOf(rawItem: unknown) {
        return buildPlaylistRecentItems(
            [
                {
                    _id: 'portal-1',
                    title: 'RUcolor.tv',
                    macAddress: '00:1A:79:00:00:01',
                    recentlyViewed: [rawItem],
                } as unknown as PlaylistMeta,
            ],
            labels
        );
    }

    it('surfaces the enriched backdrop so the hero does not need a lookup', () => {
        expect(recentItemsOf(enrichedEntry)[0].backdrop_url).toBe(
            'https://image.tmdb.org/t/p/w1280/backdrop.jpg'
        );
    });

    it('leaves the backdrop undefined for an entry saved without enrichment', () => {
        expect(
            recentItemsOf({
                id: '17573',
                title: 'Холод (10 серий)',
                cover: 'https://image.tmdb.org/t/p/w500/poster.jpg',
            })[0].backdrop_url
        ).toBeUndefined();
    });
});
