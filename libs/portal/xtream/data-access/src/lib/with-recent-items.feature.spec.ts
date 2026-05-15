import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import { of } from 'rxjs';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';
import { withRecentItems } from './with-recent-items';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const TestRecentItemsStore = signalStore(withRecentItems());
const TestLoadedContentRecentItemsStore = signalStore(
    withState({
        vodStreams: [
            {
                stream_id: 20203,
                title: 'Movie',
                type: 'movie',
                category_id: 206,
            },
        ],
    }),
    withRecentItems()
);

describe('withRecentItems', () => {
    let store: InstanceType<typeof TestRecentItemsStore>;
    let dataSource: {
        addRecentItem: jest.Mock;
        clearRecentItems: jest.Mock;
        getContentByXtreamId: jest.Mock;
        getRecentItems: jest.Mock;
        removeRecentItem: jest.Mock;
    };
    let databaseService: {
        getContentByXtreamId: jest.Mock;
        getRecentItems: jest.Mock;
        setContentBackdropIfMissing: jest.Mock;
    };

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            value: {} as Window['electron'],
            configurable: true,
        });

        dataSource = {
            addRecentItem: jest.fn().mockResolvedValue(undefined),
            clearRecentItems: jest.fn().mockResolvedValue(undefined),
            getContentByXtreamId: jest.fn(),
            getRecentItems: jest.fn().mockResolvedValue([
                {
                    id: 3941697,
                    title: 'Krypton',
                    type: 'series',
                    poster_url: 'https://example.com/krypton.png',
                    backdrop_url: 'https://example.com/krypton-backdrop.png',
                    viewed_at: '2026-04-21T20:42:27.000Z',
                    xtream_id: 290,
                    category_id: 17,
                },
            ]),
            removeRecentItem: jest.fn().mockResolvedValue(undefined),
        };

        databaseService = {
            getContentByXtreamId: jest.fn(),
            getRecentItems: jest.fn().mockResolvedValue([]),
            setContentBackdropIfMissing: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                TestRecentItemsStore,
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: dataSource,
                },
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        clearPlaylistRecentlyViewed: jest
                            .fn()
                            .mockReturnValue(of(undefined)),
                        getAllPlaylists: jest.fn().mockReturnValue(of([])),
                    },
                },
            ],
        });

        store = TestBed.inject(TestRecentItemsStore);
    });

    it('looks recent items up with the requested content type before saving one', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        store.addRecentItem({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            3941697,
            'playlist-1',
            undefined
        );
        expect(store.recentItems()).toEqual([
            expect.objectContaining({
                id: 3941697,
                title: 'Krypton',
                type: 'series',
                xtream_id: 290,
                backdrop_url: 'https://example.com/krypton-backdrop.png',
            }),
        ]);
    });

    it('uses stream_id as the PWA recent id when no database id exists', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            stream_id: 20203,
            title: 'Movie',
            type: 'movie',
            category_id: 206,
        });

        store.addRecentItem({
            xtreamId: 20203,
            contentType: 'movie',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            20203,
            'playlist-1',
            undefined
        );
    });

    it('falls back to loaded store content when the PWA source cache misses', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                TestLoadedContentRecentItemsStore,
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: dataSource,
                },
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        clearPlaylistRecentlyViewed: jest
                            .fn()
                            .mockReturnValue(of(undefined)),
                        getAllPlaylists: jest.fn().mockReturnValue(of([])),
                    },
                },
            ],
        });
        const loadedStore = TestBed.inject(TestLoadedContentRecentItemsStore);

        loadedStore.addRecentItem({
            xtreamId: 20203,
            contentType: 'movie',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            20203,
            'playlist-1',
            undefined
        );
    });

    it('forwards backdrop urls on recent-item saves', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        store.addRecentItem({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
            backdropUrl: 'https://example.com/krypton-backdrop.png',
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            3941697,
            'playlist-1',
            'https://example.com/krypton-backdrop.png'
        );
    });

    it('backfills a backdrop without rewriting recent ordering', async () => {
        databaseService.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        await store.backfillContentBackdrop({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
            backdropUrl: ' https://example.com/krypton-backdrop.png ',
        });

        expect(databaseService.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(
            databaseService.setContentBackdropIfMissing
        ).toHaveBeenCalledWith(
            3941697,
            'https://example.com/krypton-backdrop.png'
        );
        expect(dataSource.addRecentItem).not.toHaveBeenCalled();
    });
});
