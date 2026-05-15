import { TestBed } from '@angular/core/testing';
import { patchState, signalStore } from '@ngrx/signals';
import { DatabaseService } from '@iptvnator/services';
import { FavoritesService } from './services/favorites.service';
import { withFavorites } from './with-favorites.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const TestFavoritesStore = signalStore(withFavorites());

describe('withFavorites', () => {
    let store: InstanceType<typeof TestFavoritesStore>;
    let databaseService: {
        getContentByXtreamId: jest.Mock;
    };
    let favoritesService: {
        addToFavorites: jest.Mock;
        isFavorite: jest.Mock;
        removeFromFavorites: jest.Mock;
    };

    beforeEach(() => {
        databaseService = {
            getContentByXtreamId: jest.fn(),
        };
        favoritesService = {
            addToFavorites: jest.fn().mockResolvedValue(undefined),
            isFavorite: jest.fn().mockResolvedValue(false),
            removeFromFavorites: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                TestFavoritesStore,
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: FavoritesService,
                    useValue: favoritesService,
                },
            ],
        });

        store = TestBed.inject(TestFavoritesStore);
    });

    it('looks favorites up with the requested content type before adding one', async () => {
        databaseService.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        const result = await store.toggleFavorite(290, 'playlist-1', 'series');

        expect(databaseService.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(favoritesService.addToFavorites).toHaveBeenCalledWith({
            content_id: 3941697,
            playlist_id: 'playlist-1',
        });
        expect(result).toBe(true);
        expect(store.isFavorite()).toBe(true);
    });

    it('looks favorites up with the requested content type before removing one', async () => {
        databaseService.getContentByXtreamId.mockResolvedValue({
            id: 3867578,
            title: 'SE: V Film Premiere FHD',
            type: 'live',
            xtream_id: 290,
        });
        patchState(store, { isFavorite: true });

        const result = await store.toggleFavorite(290, 'playlist-1', 'live');

        expect(databaseService.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'live'
        );
        expect(favoritesService.removeFromFavorites).toHaveBeenCalledWith(
            3867578,
            'playlist-1'
        );
        expect(result).toBe(false);
        expect(store.isFavorite()).toBe(false);
    });

    it('checks favorite state against the matching content type', async () => {
        databaseService.getContentByXtreamId.mockResolvedValue({
            id: 3829429,
            title: 'Dragon Ball Heroes',
            type: 'series',
            xtream_id: 31,
        });
        favoritesService.isFavorite.mockResolvedValue(true);

        await store.checkFavoriteStatus(31, 'playlist-1', 'series');

        expect(databaseService.getContentByXtreamId).toHaveBeenCalledWith(
            31,
            'playlist-1',
            'series'
        );
        expect(favoritesService.isFavorite).toHaveBeenCalledWith(
            3829429,
            'playlist-1'
        );
        expect(store.isFavorite()).toBe(true);
    });
});
