import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withState } from '@ngrx/signals';
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
const TestLoadedContentFavoritesStore = signalStore(
    withState({
        vodStreams: [
            {
                stream_id: 20203,
                title: 'Movie',
                type: 'movie',
            },
        ],
    }),
    withFavorites()
);

describe('withFavorites', () => {
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

    it('uses stream_id as the PWA favorite id when no database id exists', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            stream_id: 20203,
            title: 'Movie',
            type: 'movie',
        });

        const result = await store.toggleFavorite(20203, 'playlist-1', 'movie');

        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            20203,
            'playlist-1',
            undefined
        );
        expect(result).toBe(true);
    });

    it('normalizes route string ids before looking up PWA content', async () => {
        dataSource.getContentByXtreamId.mockImplementation(
            async (xtreamId: number) =>
                xtreamId === 20203
                    ? {
                          stream_id: 20203,
                          title: 'Movie',
                          type: 'movie',
                      }
                    : null
        );

        const result = await store.toggleFavorite(
            '20203',
            'playlist-1',
            'movie'
        );

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            20203,
            'playlist-1',
            'movie'
        );
        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            20203,
            'playlist-1',
            undefined
        );
        expect(result).toBe(true);
    });

    it('normalizes route string ids before checking PWA favorite status', async () => {
        dataSource.getContentByXtreamId.mockImplementation(
            async (xtreamId: number) =>
                xtreamId === 20203
                    ? {
                          stream_id: 20203,
                          title: 'Movie',
                          type: 'movie',
                      }
                    : null
        );
        dataSource.isFavorite.mockResolvedValue(true);

        await store.checkFavoriteStatus('20203', 'playlist-1', 'movie');

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            20203,
            'playlist-1',
            'movie'
        );
        expect(dataSource.isFavorite).toHaveBeenCalledWith(20203, 'playlist-1');
        expect(store.isFavorite()).toBe(true);
    });

    it('falls back to loaded store content when the PWA source cache misses', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                TestLoadedContentFavoritesStore,
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: dataSource,
                },
            ],
        });
        const loadedStore = TestBed.inject(TestLoadedContentFavoritesStore);

        const result = await loadedStore.toggleFavorite(
            20203,
            'playlist-1',
            'movie'
        );

        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            20203,
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
});
