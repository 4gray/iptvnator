import { of } from 'rxjs';
import type { StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';

describe('typed shared Stalker favorites collection', () => {
    it('keeps same-ID kinds distinct and clears only the selected membership', async () => {
        const favorites: StalkerPortalItem[] = [
            { id: '42', favoriteContentType: 'vod', title: 'Synthetic movie' },
            {
                id: '42',
                favoriteContentType: 'series',
                title: 'Synthetic series',
            },
            {
                id: '42',
                favoriteContentType: 'vod',
                is_series: true,
                title: 'Synthetic lazy series',
            },
        ];
        const source = {
            _id: 'synthetic-source',
            macAddress: '00:11:22:33:44:55',
            title: 'Synthetic source',
            favorites,
        };
        const transformPlaylistFavorites = jest.fn(
            (
                _id: string,
                transform: (current: StalkerPortalItem[]) => StalkerPortalItem[]
            ) => of({ ...source, favorites: transform(favorites) })
        );
        const service = Object.create(
            UnifiedFavoritesDataService.prototype
        ) as UnifiedFavoritesDataService;
        Object.assign(service, {
            favoriteSync: {
                active: () => true,
                project: async (value: unknown) => value,
            },
            playlistsService: {
                getPlaylistById: () => of(source),
                transformPlaylistFavorites,
            },
            getPlaylistMeta: async () => source,
            translate: { instant: (key: string) => key },
        });
        const items = await service.getFavorites(
            'playlist',
            'synthetic-source',
            'stalker'
        );
        expect(new Set(items.map((item) => item.uid)).size).toBe(3);
        await service.clearFavorites([items[0]]);
        const transform = transformPlaylistFavorites.mock.calls[0][1];
        expect(transform(favorites)).toEqual(favorites.slice(1));
    });
});
