import { mutateFavoritePlaylist } from '../favorites-events';
import { removePortalFavorite } from './playlist-favorites';
import type { Playlist, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import type { FavoritesPlaylistBridge } from '../favorites-events';
describe('explicit favorite mutations', () => {
    it('retains different Stalker kinds and all series origins with the same provider ID', () => {
        const items: StalkerPortalItem[] = [
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
        for (const target of items) {
            const remaining = removePortalFavorite(items, '42', target);
            expect(remaining).toHaveLength(3);
            expect(remaining).not.toContain(target);
        }
        expect(removePortalFavorite(items, '42')).toEqual([]);
    });
    it('removes a historical untyped Stalker movie while retaining a typed series with the same ID', () => {
        const legacy = {
            id: '42',
            category_id: '17',
            title: 'Synthetic historical movie',
            cmd: 'synthetic-command',
        };
        const series = {
            id: '42',
            favoriteContentType: 'series' as const,
            title: 'Synthetic series',
        };
        expect(
            removePortalFavorite([legacy, series], '42', {
                id: '42',
                favoriteContentType: 'vod',
                category_id: '17',
            })
        ).toEqual([series]);
    });
    it('keeps the ordinary local path when no shared favorite domain handles the action', async () => {
        const source = { _id: 'source', favorites: ['legacy'] } as Playlist;
        const bridge = {
            mutate: jest.fn(async () => null),
        } as unknown as FavoritesPlaylistBridge;
        const persist = jest.fn(async (playlist: Playlist) => playlist);
        const saved = await mutateFavoritePlaylist(
            source,
            () => ['next'],
            bridge,
            persist
        );
        expect(saved.favorites).toEqual(['next']);
        expect(persist).toHaveBeenCalledWith({
            ...source,
            favorites: ['next'],
        });
    });
    it('does not replace the legacy archive after the shared domain acknowledges a new membership', async () => {
        const source = { _id: 'source', favorites: ['legacy'] } as Playlist;
        const projected = { ...source, favorites: ['shared'] };
        const bridge = {
            mutate: jest.fn(async () => projected),
        } as unknown as FavoritesPlaylistBridge;
        const persist = jest.fn(async (playlist: Playlist) => playlist);
        expect(
            await mutateFavoritePlaylist(
                source,
                () => ['shared'],
                bridge,
                persist
            )
        ).toEqual(projected);
        expect(persist).not.toHaveBeenCalled();
        expect(source.favorites).toEqual(['legacy']);
    });
});
