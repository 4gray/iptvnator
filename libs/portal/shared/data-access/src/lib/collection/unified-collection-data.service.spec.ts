import { TestBed } from '@angular/core/testing';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { FavoriteChannelFoldersService } from './favorite-channel-folders.service';
import { UnifiedCollectionDataService } from './unified-collection-data.service';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';
import { UnifiedRecentDataService } from './unified-recent-data.service';

describe('favorite channel assignments in unified collections', () => {
    const live: UnifiedCollectionItem = {
        uid: 'xtream::synthetic-source::live:11',
        sourceType: 'xtream',
        playlistId: 'synthetic-source',
        playlistName: 'Synthetic source',
        contentType: 'live',
        name: 'Synthetic channel',
        xtreamId: 11,
    };
    const movie: UnifiedCollectionItem = {
        ...live,
        uid: 'xtream::synthetic-source::movie:12',
        name: 'Synthetic movie',
        contentType: 'movie',
        xtreamId: 12,
    };
    const favoritesData = {
        getFavorites: jest.fn(),
        addFavorite: jest.fn(),
        removeFavorite: jest.fn(),
        clearFavorites: jest.fn(),
    };
    const recentData = { removeRecentItem: jest.fn() };
    const folders = { unfile: jest.fn() };
    let service: UnifiedCollectionDataService;

    beforeEach(async () => {
        jest.resetAllMocks();
        favoritesData.getFavorites.mockResolvedValue([live, movie]);
        TestBed.configureTestingModule({
            providers: [
                UnifiedCollectionDataService,
                {
                    provide: UnifiedFavoritesDataService,
                    useValue: favoritesData,
                },
                { provide: UnifiedRecentDataService, useValue: recentData },
                { provide: FavoriteChannelFoldersService, useValue: folders },
            ],
        });
        service = TestBed.inject(UnifiedCollectionDataService);
        await service.load({ mode: 'favorites', scope: 'all' });
    });

    it('keeps a favorite filed if removal fails and removes the row after a successful retry', async () => {
        const removalError = new Error('Synthetic provider failure');
        favoritesData.removeFavorite.mockRejectedValueOnce(removalError);
        await expect(service.removeItem('favorites', live)).rejects.toBe(
            removalError
        );
        expect(folders.unfile).not.toHaveBeenCalled();
        expect(service.favoriteUidSet().has(live.uid)).toBe(true);
        expect(service.allItems()).toEqual([live, movie]);

        folders.unfile.mockRejectedValueOnce(
            new Error('Synthetic folder storage failure')
        );
        await expect(
            service.removeItem('favorites', live)
        ).resolves.toBeUndefined();
        expect(folders.unfile).toHaveBeenCalledWith([live]);
        expect(service.favoriteUidSet().has(live.uid)).toBe(false);
        expect(service.allItems()).toEqual([movie]);
    });

    it('releases any previous channel assignment on ordinary toggles and bulk clearing', async () => {
        await service.toggleFavorite(live);
        expect(favoritesData.removeFavorite).toHaveBeenCalledWith(live);
        expect(service.favoriteUidSet().has(live.uid)).toBe(false);
        expect(folders.unfile).toHaveBeenCalledWith([live]);

        await service.toggleFavorite(live);
        expect(favoritesData.addFavorite).toHaveBeenCalledWith(live);
        expect(service.favoriteUidSet().has(live.uid)).toBe(true);
        expect(folders.unfile).toHaveBeenCalledTimes(2);

        await service.clearFavorites([live, movie]);
        expect(favoritesData.clearFavorites).toHaveBeenCalledWith([
            live,
            movie,
        ]);
        expect(folders.unfile).toHaveBeenLastCalledWith([live, movie]);
    });

    it('keeps assignments when a delayed mutation was canceled', async () => {
        favoritesData.removeFavorite.mockResolvedValueOnce(false);
        await service.toggleFavorite(live);
        expect(service.favoriteUidSet().has(live.uid)).toBe(true);

        favoritesData.clearFavorites.mockResolvedValueOnce(false);
        await expect(service.clearFavorites([live])).resolves.toBe(false);
        expect(folders.unfile).not.toHaveBeenCalled();
    });

    it('preserves channel assignments when removing recent channels or clearing film favorites', async () => {
        await service.removeItem('recent', live);
        expect(recentData.removeRecentItem).toHaveBeenCalledWith(live);
        await service.clearFavorites([movie]);
        expect(favoritesData.clearFavorites).toHaveBeenCalledWith([movie]);
        expect(folders.unfile).not.toHaveBeenCalled();
    });
});
