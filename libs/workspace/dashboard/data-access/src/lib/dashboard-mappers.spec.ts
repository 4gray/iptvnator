import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { buildStalkerFavoriteItems } from './dashboard-mappers';

describe('buildStalkerFavoriteItems', () => {
    function favoritesOf(favorite: unknown) {
        return buildStalkerFavoriteItems(
            [
                {
                    _id: 'portal-1',
                    title: 'Synthetic portal',
                    macAddress: '00:1A:79:00:00:01',
                    favorites: [favorite],
                } as unknown as PlaylistMeta,
            ],
            'Stalker'
        );
    }

    it('separates typed Stalker favorite identities while retaining the provider ID', () => {
        const rows = [
            { id: '42', favoriteContentType: 'vod', title: 'Synthetic movie' },
            {
                id: '42',
                favoriteContentType: 'series',
                title: 'Synthetic regular series',
            },
            {
                id: '42',
                favoriteContentType: 'vod',
                is_series: true,
                title: 'Synthetic lazy series',
            },
            {
                id: '42',
                favoriteContentType: 'vod',
                series: [1, 2],
                title: 'Synthetic embedded series',
            },
        ];
        const items = buildStalkerFavoriteItems(
            [
                {
                    _id: 'synthetic-source',
                    macAddress: 'synthetic-mac',
                    favorites: rows,
                } as unknown as PlaylistMeta,
            ],
            'Synthetic source'
        );
        expect(new Set(items.map((item) => item.id)).size).toBe(4);
        expect(items.map((item) => item.xtream_id)).toEqual([
            '42',
            '42',
            '42',
            '42',
        ]);
        expect(items.map((item) => item.stalker_item)).toEqual(rows);
    });
    it('surfaces the backdrop the detail view merged into the entry', () => {
        // Stalker items never reach the `content` table, so the enriched
        // backdrop travels inside the stored favorite itself.
        const [item] = favoritesOf({
            id: '900201',
            category_id: '7',
            title: 'Тестовый сериал Альфа (10 серий)',
            cover: 'https://image.tmdb.org/t/p/w500/poster.jpg',
            info: {
                name: 'Тестовый сериал Альфа (10 серий)',
                tmdb_backdrop: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
            },
        });

        expect(item.backdrop_url).toBe(
            'https://image.tmdb.org/t/p/w1280/backdrop.jpg'
        );
        expect(item.poster_url).toBe(
            'https://image.tmdb.org/t/p/w500/poster.jpg'
        );
    });

    it('leaves the backdrop undefined for an entry saved without enrichment', () => {
        const [item] = favoritesOf({
            id: '900201',
            title: 'Тестовый сериал Альфа (10 серий)',
            cover: 'https://image.tmdb.org/t/p/w500/poster.jpg',
        });

        expect(item.backdrop_url).toBeUndefined();
    });
});
