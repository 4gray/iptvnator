import { TestBed } from '@angular/core/testing';
import { patchState, signalStore } from '@ngrx/signals';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';
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
    const originalElectron = window.electron;
    let store: InstanceType<typeof TestFavoritesStore>;
    let dataSource: {
        addFavorite: jest.Mock;
        getContentByXtreamId: jest.Mock;
        isFavorite: jest.Mock;
        removeFavorite: jest.Mock;
    };

    beforeEach(() => {
        dataSource = {
            addFavorite: jest.fn().mockResolvedValue(undefined),
            getContentByXtreamId: jest.fn(),
            isFavorite: jest.fn().mockResolvedValue(false),
            removeFavorite: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                TestFavoritesStore,
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: dataSource,
                },
            ],
        });

        store = TestBed.inject(TestFavoritesStore);
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: originalElectron,
        });
    });

    it('looks favorites up with the requested content type before adding one', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        const result = await store.toggleFavorite(290, 'playlist-1', 'series');

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            3941697,
            'playlist-1',
            undefined
        );
        expect(result).toBe(true);
        expect(store.isFavorite()).toBe(true);
    });

    it('uses the Xtream ID as the PWA favorite key when cached content is cold', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        const result = await store.toggleFavorite(
            1767451,
            'playlist-1',
            'movie'
        );

        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            1767451,
            'playlist-1',
            undefined
        );
        expect(result).toBe(true);
        expect(store.isFavorite()).toBe(true);
    });

    it('normalizes route-param Xtream IDs before using the PWA favorite fallback', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        const result = await store.toggleFavorite(
            '1767451',
            'playlist-1',
            'movie'
        );

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            1767451,
            'playlist-1',
            'movie'
        );
        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            1767451,
            'playlist-1',
            undefined
        );
        expect(result).toBe(true);
    });

    it('looks favorites up with the requested content type before removing one', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3867578,
            title: 'SE: V Film Premiere FHD',
            type: 'live',
            xtream_id: 290,
        });
        patchState(store, { isFavorite: true });

        const result = await store.toggleFavorite(290, 'playlist-1', 'live');

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'live'
        );
        expect(dataSource.removeFavorite).toHaveBeenCalledWith(
            3867578,
            'playlist-1'
        );
        expect(result).toBe(false);
        expect(store.isFavorite()).toBe(false);
    });

    it('checks favorite state against the matching content type', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3829429,
            title: 'Dragon Ball Heroes',
            type: 'series',
            xtream_id: 31,
        });
        dataSource.isFavorite.mockResolvedValue(true);

        await store.checkFavoriteStatus(31, 'playlist-1', 'series');

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            31,
            'playlist-1',
            'series'
        );
        expect(dataSource.isFavorite).toHaveBeenCalledWith(
            3829429,
            'playlist-1'
        );
        expect(store.isFavorite()).toBe(true);
    });

    it('checks PWA favorite state against the Xtream ID when cached content is cold', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        dataSource.isFavorite.mockResolvedValue(true);

        await store.checkFavoriteStatus(1767451, 'playlist-1', 'movie');

        expect(dataSource.isFavorite).toHaveBeenCalledWith(
            1767451,
            'playlist-1'
        );
        expect(store.isFavorite()).toBe(true);
    });
});
