import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { buildStalkerFavoriteItems } from './dashboard-mappers';

describe('buildStalkerFavoriteItems', () => {
    function favoritesOf(favorite: unknown) {
        return buildStalkerFavoriteItems(
            [
                {
                    _id: 'portal-1',
                    title: 'RUcolor.tv',
                    macAddress: '00:1A:79:00:00:01',
                    favorites: [favorite],
                } as unknown as PlaylistMeta,
            ],
            'Stalker'
        );
    }

    it('surfaces the backdrop the detail view merged into the entry', () => {
        // Stalker items never reach the `content` table, so the enriched
        // backdrop travels inside the stored favorite itself.
        const [item] = favoritesOf({
            id: '17573',
            category_id: '7',
            title: 'Холод (10 серий)',
            cover: 'https://image.tmdb.org/t/p/w500/poster.jpg',
            info: {
                name: 'Холод (10 серий)',
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
            id: '17573',
            title: 'Холод (10 серий)',
            cover: 'https://image.tmdb.org/t/p/w500/poster.jpg',
        });

        expect(item.backdrop_url).toBeUndefined();
    });
});
