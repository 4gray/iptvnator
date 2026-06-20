import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import {
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { of, Subject } from 'rxjs';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import {
    PlaybackPositionData,
    Playlist,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import {
    DashboardDataService,
    DashboardFavoriteItem,
    GlobalRecentItem,
} from './dashboard-data.service';

describe('DashboardDataService', () => {
    let service: DashboardDataService;
    const playlistsLoadedSignal = signal(true);

    const waitForMockCall = async (mock: jest.Mock, attempts = 10) => {
        for (let index = 0; index < attempts; index++) {
            if (mock.mock.calls.length > 0) {
                return;
            }
            await Promise.resolve();
        }

        throw new Error('Expected mock to be called');
    };

    const createPendingItems = <T = never>() => {
        let resolvePending: (items: T[]) => void = () => {
            throw new Error('Pending item promise resolved before init');
        };
        const promise = new Promise<T[]>((resolve) => {
            resolvePending = resolve;
        });

        return {
            promise,
            resolve: resolvePending,
        };
    };

    const createDefaultPlaylists = (): PlaylistMeta[] => [
        {
            _id: 'm3u-1',
            title: 'M3U Playlist',
            count: 1,
            importDate: '2026-01-01T00:00:00.000Z',
            autoRefresh: false,
            favorites: ['channel-1', 'https://example.com/stream-2.m3u8'],
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'https://example.com/stream-1.m3u8',
                    url: 'https://example.com/stream-1.m3u8',
                    title: 'Channel One',
                    channel_id: 'channel-1',
                    poster_url: 'https://example.com/logo-1.png',
                    tvg_id: 'tvg-1',
                    tvg_name: 'Channel One',
                    group_title: 'News',
                    category_id: 'live',
                    added_at: '2026-02-01T12:00:00.000Z',
                },
            ],
        },
        {
            _id: 'xtream-1',
            title: 'Xtream Playlist',
            count: 1,
            importDate: '2026-01-01T00:00:00.000Z',
            autoRefresh: false,
            serverUrl: 'https://example.com',
        },
    ];

    const playlistsSignal = signal<PlaylistMeta[]>(createDefaultPlaylists());

    const storeMock = {
        selectSignal: jest.fn((selector: unknown) => {
            if (selector === selectAllPlaylistsMeta) {
                return playlistsSignal;
            }
            if (selector === selectPlaylistsLoadingFlag) {
                return playlistsLoadedSignal;
            }
            return signal(null);
        }),
        dispatch: jest.fn(),
    };

    const dbServiceMock = {
        getGlobalRecentlyAdded: jest.fn().mockResolvedValue([]),
        getGlobalRecentlyViewed: jest.fn().mockResolvedValue([]),
        getAllGlobalFavorites: jest.fn().mockResolvedValue([]),
        removeFromFavorites: jest.fn().mockResolvedValue(undefined),
        removeRecentItem: jest.fn().mockResolvedValue(undefined),
    };
    const xtreamDataSourceMock = {
        getFavorites: jest.fn().mockResolvedValue([]),
        getRecentItems: jest.fn().mockResolvedValue([]),
        removeFavorite: jest.fn().mockResolvedValue(undefined),
        removeRecentItem: jest.fn().mockResolvedValue(undefined),
    };
    const playlistMock: Playlist = {
        _id: 'm3u-1',
        title: 'M3U Playlist',
        count: 2,
        importDate: '2026-01-01T00:00:00.000Z',
        lastUsage: '2026-01-01T00:00:00.000Z',
        autoRefresh: false,
        favorites: ['channel-1', 'https://example.com/stream-2.m3u8'],
        playlist: {
            items: [
                {
                    id: 'channel-1',
                    name: 'Channel One',
                    url: 'https://example.com/stream-1.m3u8',
                    tvg: {
                        logo: 'https://example.com/logo-1.png',
                        id: 'tvg-1',
                        name: 'Channel One',
                    },
                },
                {
                    id: 'channel-2',
                    name: 'Channel Two',
                    url: 'https://example.com/stream-2.m3u8',
                    tvg: {
                        logo: 'https://example.com/logo-2.png',
                        id: 'tvg-2',
                        name: 'Channel Two',
                    },
                },
            ],
        },
    } as Playlist;
    const playlistsServiceMock = {
        getM3uFavoriteChannels: jest.fn().mockReturnValue(of(null)),
        getPlaylistById: jest.fn().mockReturnValue(of(playlistMock)),
        setFavorites: jest.fn().mockReturnValue(of(undefined)),
        removeFromM3uRecentlyViewed: jest.fn().mockReturnValue(
            of({
                ...playlistMock,
                recentlyViewed: [],
            })
        ),
    };

    const playbackPositionsMock = {
        savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
        getPlaybackPosition: jest.fn().mockResolvedValue(null),
        getSeriesPlaybackPositions: jest.fn().mockResolvedValue([]),
        getAllPlaybackPositions: jest
            .fn<Promise<PlaybackPositionData[]>, [string]>()
            .mockResolvedValue([]),
        clearPlaybackPosition: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            value: {
                dbGetRecentlyViewed: jest.fn(),
                dbClearRecentlyViewed: jest.fn(),
                dbGetAllGlobalFavorites: jest.fn(),
                dbGetGlobalRecentlyAdded: jest.fn(),
                dbAddFavorite: jest.fn(),
                dbRemoveRecentItem: jest.fn(),
                dbRemoveFavorite: jest.fn(),
                dbGetFavorites: jest.fn(),
                dbReorderGlobalFavorites: jest.fn(),
                dbGetRecentItems: jest.fn(),
                dbAddRecentItem: jest.fn(),
                dbClearPlaylistRecentItems: jest.fn(),
                dbRemoveRecentItemsBatch: jest.fn(),
                dbGetContentByXtreamId: jest.fn(),
            } as unknown as Window['electron'],
            configurable: true,
        });
        playlistsLoadedSignal.set(true);
        playlistsSignal.set(createDefaultPlaylists());
        playlistsServiceMock.getM3uFavoriteChannels.mockClear();
        playlistsServiceMock.getM3uFavoriteChannels.mockReturnValue(of(null));
        playlistsServiceMock.getPlaylistById.mockClear();
        playlistsServiceMock.getPlaylistById.mockReturnValue(of(playlistMock));
        playlistsServiceMock.setFavorites.mockClear();
        playlistsServiceMock.setFavorites.mockReturnValue(of(undefined));
        playlistsServiceMock.removeFromM3uRecentlyViewed.mockClear();
        playlistsServiceMock.removeFromM3uRecentlyViewed.mockReturnValue(
            of({
                ...playlistMock,
                recentlyViewed: [],
            })
        );
        dbServiceMock.getAllGlobalFavorites.mockClear();
        dbServiceMock.getAllGlobalFavorites.mockResolvedValue([]);
        dbServiceMock.getGlobalRecentlyAdded.mockClear();
        dbServiceMock.getGlobalRecentlyAdded.mockResolvedValue([]);
        dbServiceMock.getGlobalRecentlyViewed.mockClear();
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([]);
        dbServiceMock.removeFromFavorites.mockClear();
        dbServiceMock.removeRecentItem.mockClear();
        xtreamDataSourceMock.getFavorites.mockClear();
        xtreamDataSourceMock.getFavorites.mockResolvedValue([]);
        xtreamDataSourceMock.getRecentItems.mockClear();
        xtreamDataSourceMock.getRecentItems.mockResolvedValue([]);
        xtreamDataSourceMock.removeFavorite.mockClear();
        xtreamDataSourceMock.removeFavorite.mockResolvedValue(undefined);
        xtreamDataSourceMock.removeRecentItem.mockClear();
        xtreamDataSourceMock.removeRecentItem.mockResolvedValue(undefined);
        storeMock.dispatch.mockClear();

        playbackPositionsMock.getAllPlaybackPositions.mockClear();
        playbackPositionsMock.getAllPlaybackPositions.mockResolvedValue([]);

        TestBed.configureTestingModule({
            providers: [
                DashboardDataService,
                { provide: Store, useValue: storeMock },
                { provide: DatabaseService, useValue: dbServiceMock },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: xtreamDataSourceMock,
                },
                {
                    provide: PlaylistsService,
                    useValue: playlistsServiceMock,
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        onLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: playbackPositionsMock,
                },
            ],
        });
        service = TestBed.inject(DashboardDataService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('does not eagerly load dashboard datasets on construction', () => {
        expect(dbServiceMock.getGlobalRecentlyViewed).not.toHaveBeenCalled();
        expect(dbServiceMock.getAllGlobalFavorites).not.toHaveBeenCalled();
        expect(dbServiceMock.getGlobalRecentlyAdded).not.toHaveBeenCalled();
        expect(playlistsServiceMock.getPlaylistById).not.toHaveBeenCalled();
        expect(service.globalFavoritesLoaded()).toBe(false);
        expect(service.globalFavoritesLoading()).toBe(true);
        expect(service.dashboardReady()).toBe(false);
    });

    it('keeps dashboardReady false until xtream recently added finishes its first load', async () => {
        expect(service.dashboardReady()).toBe(false);

        await service.reloadGlobalRecentItems();
        expect(service.dashboardReady()).toBe(false);

        await service.reloadGlobalFavorites();
        expect(service.dashboardReady()).toBe(false);

        await service.reloadXtreamRecentlyAddedItems();
        expect(service.dashboardReady()).toBe(true);
    });

    it('does not wait on xtream recently added when no xtream playlists exist', async () => {
        playlistsSignal.set([
            {
                _id: 'm3u-1',
                title: 'M3U Playlist',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                favorites: [],
                recentlyViewed: [],
            },
        ]);

        await service.reloadGlobalRecentItems();
        expect(service.dashboardReady()).toBe(false);

        await service.reloadGlobalFavorites();
        expect(service.dashboardReady()).toBe(true);
    });

    it('includes M3U favorites in global favorite items', async () => {
        await service.reloadGlobalFavorites();

        expect(service.globalFavoriteItems()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'channel-1',
                    title: 'Channel One',
                    type: 'live',
                    playlist_id: 'm3u-1',
                    source: 'm3u',
                    poster_url: 'https://example.com/logo-1.png',
                    epg_lookup_key: 'tvg-1',
                }),
                expect.objectContaining({
                    id: 'https://example.com/stream-2.m3u8',
                    title: 'Channel Two',
                    type: 'live',
                    playlist_id: 'm3u-1',
                    source: 'm3u',
                    poster_url: 'https://example.com/logo-2.png',
                    epg_lookup_key: 'tvg-2',
                }),
            ])
        );
    });

    it('uses resolved M3U favorite channels when Electron can provide them without loading the full playlist payload', async () => {
        playlistsServiceMock.getM3uFavoriteChannels.mockReturnValue(
            of([
                {
                    favoriteId: 'channel-1',
                    favoriteIndex: 0,
                    channel: playlistMock.playlist.items[0],
                },
                {
                    favoriteId: 'https://example.com/stream-2.m3u8',
                    favoriteIndex: 1,
                    channel: playlistMock.playlist.items[1],
                },
            ])
        );

        await service.reloadGlobalFavorites();

        expect(
            playlistsServiceMock.getM3uFavoriteChannels
        ).toHaveBeenCalledWith('m3u-1');
        expect(playlistsServiceMock.getPlaylistById).not.toHaveBeenCalled();
        expect(service.globalFavoriteItems()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'channel-1',
                    title: 'Channel One',
                    source: 'm3u',
                }),
                expect.objectContaining({
                    id: 'https://example.com/stream-2.m3u8',
                    title: 'Channel Two',
                    source: 'm3u',
                }),
            ])
        );
    });

    it('keeps initial global favorites loading until playlist-backed favorites finish loading', async () => {
        const pendingM3uPlaylist = new Subject<Playlist>();
        playlistsServiceMock.getPlaylistById.mockReturnValue(
            pendingM3uPlaylist.asObservable()
        );

        dbServiceMock.getAllGlobalFavorites.mockResolvedValue([
            {
                id: 501,
                category_id: 19,
                title: 'Fast Xtream Channel',
                added_at: '2026-04-22T10:00:00.000Z',
                poster_url: 'https://example.com/fav-channel.png',
                xtream_id: 5501,
                type: 'live',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);

        const reload = service.reloadGlobalFavorites();
        await Promise.resolve();
        await waitForMockCall(playlistsServiceMock.getPlaylistById);

        expect(service.globalFavoriteLiveItems()).toEqual([
            expect.objectContaining({ title: 'Fast Xtream Channel' }),
        ]);
        expect(service.globalFavoritesLoaded()).toBe(false);
        expect(service.globalFavoritesLoading()).toBe(true);

        pendingM3uPlaylist.next(playlistMock);
        pendingM3uPlaylist.complete();
        await reload;

        expect(service.globalFavoritesLoaded()).toBe(true);
        expect(service.globalFavoritesLoading()).toBe(false);
        expect(service.globalFavoriteLiveItems()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ title: 'Fast Xtream Channel' }),
                expect.objectContaining({ title: 'Channel One' }),
                expect.objectContaining({ title: 'Channel Two' }),
            ])
        );
    });

    it('reloads M3U favorites when playlists finish loading before the first global favorites reload completes', async () => {
        playlistsLoadedSignal.set(false);
        playlistsSignal.set([]);
        TestBed.flushEffects();

        const pendingXtreamFavorites = createPendingItems();
        dbServiceMock.getAllGlobalFavorites.mockReturnValue(
            pendingXtreamFavorites.promise
        );

        const reload = service.reloadGlobalFavorites();
        await Promise.resolve();

        expect(playlistsServiceMock.getPlaylistById).not.toHaveBeenCalled();

        playlistsSignal.set(createDefaultPlaylists());
        playlistsLoadedSignal.set(true);
        TestBed.flushEffects();
        await Promise.resolve();

        expect(playlistsServiceMock.getPlaylistById).not.toHaveBeenCalled();

        pendingXtreamFavorites.resolve([]);
        await reload;
        TestBed.flushEffects();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(playlistsServiceMock.getPlaylistById).toHaveBeenCalledWith(
            'm3u-1'
        );
        expect(service.globalFavoriteLiveItems()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ title: 'Channel One' }),
                expect.objectContaining({ title: 'Channel Two' }),
            ])
        );
        expect(service.globalFavoritesLoaded()).toBe(true);
        expect(service.globalFavoritesLoading()).toBe(false);
    });

    it('keeps the earliest matching M3U favorite id when channel id and URL both match', async () => {
        const channel = playlistMock.playlist.items[0];
        const channelUrl = channel.url;
        const channelId = channel.id;

        playlistsSignal.set([
            {
                ...createDefaultPlaylists()[0],
                favorites: [channelUrl, channelId],
            },
        ]);
        playlistsServiceMock.getPlaylistById.mockReturnValue(
            of({
                ...playlistMock,
                favorites: [channelUrl, channelId],
                playlist: {
                    items: [channel],
                },
            } as Playlist)
        );

        await service.reloadGlobalFavorites();

        expect(
            service.globalFavoriteItems().find((item) => item.source === 'm3u')
        ).toEqual(
            expect.objectContaining({
                id: channelUrl,
                title: 'Channel One',
            })
        );
    });

    it('includes Xtream movies and series in global favorite items', async () => {
        dbServiceMock.getAllGlobalFavorites.mockResolvedValue([
            {
                id: 51,
                category_id: 12,
                title: 'Action Movie',
                rating: '8.0',
                added_at: '2026-02-02T10:00:00.000Z',
                poster_url: 'https://example.com/movie.png',
                xtream_id: 5001,
                type: 'movie',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
            {
                id: 52,
                category_id: 13,
                title: 'Sci-Fi Series',
                rating: '8.7',
                added_at: '2026-02-03T10:00:00.000Z',
                poster_url: 'https://example.com/series.png',
                xtream_id: 5002,
                type: 'series',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);

        await service.reloadGlobalFavorites();

        expect(service.globalFavoriteItems()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 51,
                    title: 'Action Movie',
                    type: 'movie',
                    source: 'xtream',
                }),
                expect.objectContaining({
                    id: 52,
                    title: 'Sci-Fi Series',
                    type: 'series',
                    source: 'xtream',
                }),
            ])
        );
        expect(
            service
                .globalFavoriteItems()
                .filter((item) => item.type === 'movie')
        ).toHaveLength(1);
        expect(
            service
                .globalFavoriteItems()
                .filter((item) => item.type === 'series')
        ).toHaveLength(1);
    });

    it('includes PWA Xtream favorites from the active data source', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        xtreamDataSourceMock.getFavorites.mockResolvedValue([
            {
                id: 51,
                category_id: 12,
                title: 'Action Movie',
                rating: '8.0',
                added_at: '2026-02-02T10:00:00.000Z',
                poster_url: 'https://example.com/movie.png',
                xtream_id: 5001,
                type: 'movie',
            },
        ]);

        await service.reloadGlobalFavorites();

        expect(xtreamDataSourceMock.getFavorites).toHaveBeenCalledWith(
            'xtream-1'
        );
        expect(dbServiceMock.getAllGlobalFavorites).not.toHaveBeenCalled();
        expect(service.globalFavoriteItems()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 51,
                    title: 'Action Movie',
                    type: 'movie',
                    playlist_id: 'xtream-1',
                    playlist_name: 'Xtream Playlist',
                    source: 'xtream',
                }),
            ])
        );
    });

    it('loads PWA Xtream favorites for multiple playlists in parallel', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        playlistsSignal.set([
            {
                _id: 'xtream-1',
                title: 'Xtream One',
                serverUrl: 'https://one.example.com',
            },
            {
                _id: 'xtream-2',
                title: 'Xtream Two',
                serverUrl: 'https://two.example.com',
            },
        ]);
        const firstFavorites = createPendingItems();
        xtreamDataSourceMock.getFavorites.mockImplementation((playlistId) =>
            playlistId === 'xtream-1'
                ? firstFavorites.promise
                : Promise.resolve([])
        );

        const reload = service.reloadGlobalFavorites();
        await Promise.resolve();

        expect(xtreamDataSourceMock.getFavorites).toHaveBeenCalledWith(
            'xtream-1'
        );
        expect(xtreamDataSourceMock.getFavorites).toHaveBeenCalledWith(
            'xtream-2'
        );

        firstFavorites.resolve([]);
        await reload;
    });

    it('uses the epoch fallback for PWA Xtream favorites with empty added dates', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        xtreamDataSourceMock.getFavorites.mockResolvedValue([
            {
                id: 52,
                category_id: 12,
                title: 'Undated Movie',
                rating: '8.0',
                added: '',
                poster_url: 'https://example.com/movie.png',
                xtream_id: 5002,
                type: 'movie',
            },
        ]);

        await service.reloadGlobalFavorites();

        expect(service.globalFavoriteItems()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 52,
                    added_at: new Date(0).toISOString(),
                }),
            ])
        );
    });

    it('does not load Stalker playlists through the PWA Xtream favorites path', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        playlistsSignal.set([
            {
                _id: 'xtream-1',
                title: 'Xtream Playlist',
                serverUrl: 'https://xtream.example.com',
            },
            {
                _id: 'stalker-1',
                title: 'Stalker Playlist',
                serverUrl: 'https://stalker.example.com',
                macAddress: '00:11:22:33:44:55',
            },
        ]);

        await service.reloadGlobalFavorites();

        expect(xtreamDataSourceMock.getFavorites).toHaveBeenCalledTimes(1);
        expect(xtreamDataSourceMock.getFavorites).toHaveBeenCalledWith(
            'xtream-1'
        );
    });

    it('builds the M3U favorites route', async () => {
        await service.reloadGlobalFavorites();
        const m3uItem = service
            .globalFavoriteItems()
            .find((item) => item.source === 'm3u');

        expect(m3uItem).toBeDefined();
        expect(service.getGlobalFavoriteLink(m3uItem!)).toEqual([
            '/workspace',
            'playlists',
            'm3u-1',
            'favorites',
        ]);
        expect(service.getGlobalFavoriteNavigationState(m3uItem!)).toEqual({
            openLiveCollectionItem: {
                contentType: 'live',
                sourceType: 'm3u',
                playlistId: 'm3u-1',
                itemId: 'channel-1',
                title: 'Channel One',
                imageUrl: 'https://example.com/logo-1.png',
            },
        });
    });

    it('routes Xtream non-live favorites through the global favorites page with inline detail state', async () => {
        dbServiceMock.getAllGlobalFavorites.mockResolvedValue([
            {
                id: 51,
                category_id: 12,
                title: 'Action Movie',
                rating: '8.0',
                added_at: '2026-02-02T10:00:00.000Z',
                poster_url: 'https://example.com/movie.png',
                xtream_id: 5001,
                type: 'movie',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);

        await service.reloadGlobalFavorites();
        const movieItem = service
            .globalFavoriteItems()
            .find((item) => item.type === 'movie');

        expect(movieItem).toBeDefined();
        expect(service.getGlobalFavoriteLink(movieItem!)).toEqual([
            '/workspace',
            'global-favorites',
        ]);
        expect(service.getGlobalFavoriteNavigationState(movieItem!)).toEqual({
            openCollectionDetailItem: {
                item: expect.objectContaining({
                    uid: 'xtream::xtream-1::movie:5001',
                    name: 'Action Movie',
                    contentType: 'movie',
                    sourceType: 'xtream',
                    playlistId: 'xtream-1',
                }),
            },
        });
    });

    it('removes M3U favorites via PlaylistsService', async () => {
        await service.reloadGlobalFavorites();
        const m3uItem = service
            .globalFavoriteItems()
            .find((item) => item.id === 'channel-1');

        expect(m3uItem).toBeDefined();

        await service.removeGlobalFavorite(m3uItem!);

        expect(playlistsServiceMock.setFavorites).toHaveBeenCalledWith(
            'm3u-1',
            ['https://example.com/stream-2.m3u8']
        );
    });

    it('removes PWA Xtream favorites through the active data source', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        const item = {
            id: 51,
            category_id: 12,
            title: 'Action Movie',
            poster_url: 'https://example.com/movie.png',
            xtream_id: 5001,
            type: 'movie',
            playlist_id: 'xtream-1',
            playlist_name: 'Xtream Playlist',
            source: 'xtream',
        } satisfies DashboardFavoriteItem;

        await service.removeGlobalFavorite(item);

        expect(xtreamDataSourceMock.removeFavorite).toHaveBeenCalledWith(
            51,
            'xtream-1'
        );
        expect(dbServiceMock.removeFromFavorites).not.toHaveBeenCalled();
        expect(xtreamDataSourceMock.getFavorites).toHaveBeenCalledWith(
            'xtream-1'
        );
    });

    it('includes M3U recently viewed items in global recent items', () => {
        expect(service.globalRecentItems()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'https://example.com/stream-1.m3u8',
                    title: 'Channel One',
                    type: 'live',
                    playlist_id: 'm3u-1',
                    source: 'm3u',
                    xtream_id: 'https://example.com/stream-1.m3u8',
                    epg_lookup_key: 'tvg-1',
                }),
            ])
        );
    });

    it('splits global recent items into VOD and live computed signals so the dashboard can render two rails', async () => {
        // Seed an Xtream movie and an Xtream series alongside the M3U live
        // channel already present in defaultPlaylists, then verify the
        // splits land on the right computed signal.
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([
            {
                id: 401,
                category_id: 18,
                title: 'Recent Movie',
                rating: '7.8',
                viewed_at: '2026-04-21T10:00:00.000Z',
                poster_url: 'https://example.com/recent-movie.png',
                xtream_id: 7001,
                type: 'movie',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
            {
                id: 402,
                category_id: 19,
                title: 'Recent Series',
                rating: '8.1',
                viewed_at: '2026-04-22T10:00:00.000Z',
                poster_url: 'https://example.com/recent-series.png',
                xtream_id: 7002,
                type: 'series',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);

        playlistsSignal.set([
            ...playlistsSignal(),
            {
                _id: 'xtream-1',
                title: 'Xtream Playlist',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://example.com',
            },
        ]);

        await service.reloadGlobalRecentItems();

        const vodTitles = service
            .globalRecentVodItems()
            .map((item) => item.title);
        const liveTitles = service
            .globalRecentLiveItems()
            .map((item) => item.title);

        expect(vodTitles).toEqual(
            expect.arrayContaining(['Recent Movie', 'Recent Series'])
        );
        expect(vodTitles).not.toContain('Channel One');

        expect(liveTitles).toContain('Channel One');
        expect(liveTitles).not.toEqual(
            expect.arrayContaining(['Recent Movie', 'Recent Series'])
        );

        // Splits stay mutually exclusive — sum of partitions equals the whole.
        expect(
            service.globalRecentVodItems().length +
                service.globalRecentLiveItems().length
        ).toBe(service.globalRecentItems().length);
    });

    it('loads playback positions for every playlist that owns VOD/series recent items and exposes them by content key', async () => {
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([
            {
                id: 101,
                category_id: 18,
                title: 'Atlantic City',
                rating: '7.3',
                viewed_at: '2026-04-21T10:00:00.000Z',
                poster_url: 'https://example.com/atlantic.png',
                xtream_id: 4242,
                type: 'movie',
                playlist_id: 'xtream-A',
                playlist_name: 'Xtream A',
            },
            {
                id: 102,
                category_id: 19,
                title: 'Color Orchard S02E04',
                rating: '8.1',
                viewed_at: '2026-04-22T10:00:00.000Z',
                poster_url: 'https://example.com/orchard.png',
                xtream_id: 909,
                type: 'series',
                playlist_id: 'xtream-B',
                playlist_name: 'Xtream B',
            },
        ]);

        playlistsSignal.set([
            ...playlistsSignal(),
            {
                _id: 'xtream-A',
                title: 'Xtream A',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://a.example.com',
            },
            {
                _id: 'xtream-B',
                title: 'Xtream B',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://b.example.com',
            },
        ]);

        playbackPositionsMock.getAllPlaybackPositions.mockImplementation(
            (playlistId: string) => {
                if (playlistId === 'xtream-A') {
                    return Promise.resolve([
                        {
                            contentXtreamId: 4242,
                            contentType: 'vod',
                            positionSeconds: 3600,
                            durationSeconds: 6000,
                            playlistId,
                        } as PlaybackPositionData,
                    ]);
                }
                if (playlistId === 'xtream-B') {
                    return Promise.resolve([
                        {
                            contentXtreamId: 909,
                            contentType: 'episode',
                            seriesXtreamId: 900,
                            seasonNumber: 2,
                            episodeNumber: 4,
                            positionSeconds: 720,
                            durationSeconds: 1800,
                            playlistId,
                        } as PlaybackPositionData,
                    ]);
                }
                return Promise.resolve([]);
            }
        );

        await service.reloadGlobalRecentItems();
        await service.reloadPlaybackPositions();

        // Bulk fetched once per playlist that owns a tracked item — and ONLY
        // for the playlists that own VOD/series recent items. The default M3U
        // playlist (live channel) must not be queried.
        const queriedPlaylists =
            playbackPositionsMock.getAllPlaybackPositions.mock.calls.map(
                (call) => call[0]
            );
        expect(new Set(queriedPlaylists)).toEqual(
            new Set(['xtream-A', 'xtream-B'])
        );

        const vodItems = service.globalRecentVodItems();
        const movie = vodItems.find((item) => item.title === 'Atlantic City');
        const series = vodItems.find(
            (item) => item.title === 'Color Orchard S02E04'
        );

        // Movie: vod position with 60% watched.
        const moviePos = service.getPlaybackPositionForItem(movie!);
        expect(moviePos?.positionSeconds).toBe(3600);
        expect(moviePos?.contentType).toBe('vod');

        // Series: episode position keyed by the recent item's xtream_id (the
        // episode id, not the series id).
        const seriesPos = service.getPlaybackPositionForItem(series!);
        expect(seriesPos?.contentType).toBe('episode');
        expect(seriesPos?.positionSeconds).toBe(720);
        // Season/episode metadata travels with the position so cards can
        // render an "S2 · E5" badge without an extra round-trip.
        expect(seriesPos?.seasonNumber).toBe(2);
        expect(seriesPos?.episodeNumber).toBe(4);
    });

    it('resolves the latest episode position for series whose recent_items row carries the series id', async () => {
        // The Xtream series landing page records the recent item with the
        // SERIES id, while each played episode saves its position keyed by
        // the EPISODE id (with seriesXtreamId pointing back). The lookup
        // must follow seriesXtreamId so both card shapes show progress.
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([
            {
                id: 200,
                category_id: 30,
                title: 'Shadow Bay',
                rating: '7.5',
                viewed_at: '2026-05-01T09:00:00.000Z',
                poster_url: 'https://example.com/shadow-bay.png',
                xtream_id: 4000, // series id
                type: 'series',
                playlist_id: 'xtream-C',
                playlist_name: 'Xtream C',
            },
        ]);
        playlistsSignal.set([
            ...playlistsSignal(),
            {
                _id: 'xtream-C',
                title: 'Xtream C',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://c.example.com',
            },
        ]);
        playbackPositionsMock.getAllPlaybackPositions.mockImplementation(
            (playlistId: string) => {
                if (playlistId === 'xtream-C') {
                    return Promise.resolve([
                        // Earlier episode — should NOT win even if it also
                        // matches the series, because the newer one is more
                        // relevant for "where you left off".
                        {
                            contentXtreamId: 4001,
                            contentType: 'episode',
                            seriesXtreamId: 4000,
                            seasonNumber: 1,
                            episodeNumber: 1,
                            positionSeconds: 60,
                            durationSeconds: 1800,
                            playlistId,
                            updatedAt: '2026-04-25T12:00:00.000Z',
                        } as PlaybackPositionData,
                        {
                            contentXtreamId: 4007,
                            contentType: 'episode',
                            seriesXtreamId: 4000,
                            seasonNumber: 3,
                            episodeNumber: 7,
                            positionSeconds: 540,
                            durationSeconds: 1800,
                            playlistId,
                            updatedAt: '2026-05-01T09:30:00.000Z',
                        } as PlaybackPositionData,
                    ]);
                }
                return Promise.resolve([]);
            }
        );

        await service.reloadGlobalRecentItems();
        await service.reloadPlaybackPositions();

        const series = service
            .globalRecentVodItems()
            .find((item) => item.title === 'Shadow Bay');
        const positionsMap = service.playbackPositions$();
        const failOnLinearScan = jest.fn(() => {
            throw new Error('series lookup should not scan all positions');
        });
        (
            positionsMap as unknown as {
                values: () => IterableIterator<PlaybackPositionData>;
            }
        ).values =
            failOnLinearScan as unknown as () => IterableIterator<PlaybackPositionData>;

        expect(series).toBeDefined();
        if (!series) {
            throw new Error('expected Shadow Bay recent item');
        }

        const position = service.getPlaybackPositionForItem(series);
        expect(position?.contentType).toBe('episode');
        expect(position?.seasonNumber).toBe(3);
        expect(position?.episodeNumber).toBe(7);
        expect(failOnLinearScan).not.toHaveBeenCalled();
    });

    it('exposes a live-only slice of global favorites so the dashboard can promote favorited channels into the Live rail', async () => {
        // Seed two favorites: a movie and a live channel.
        dbServiceMock.getAllGlobalFavorites.mockResolvedValue([
            {
                id: 500,
                category_id: 18,
                title: 'Favorite Movie',
                rating: '7.0',
                added_at: '2026-04-21T10:00:00.000Z',
                poster_url: 'https://example.com/fav-movie.png',
                xtream_id: 5500,
                type: 'movie',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
            {
                id: 501,
                category_id: 19,
                title: 'Favorite Channel HD',
                rating: '0',
                added_at: '2026-04-22T10:00:00.000Z',
                poster_url: 'https://example.com/fav-channel.png',
                xtream_id: 5501,
                type: 'live',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);
        playlistsSignal.set([
            ...playlistsSignal(),
            {
                _id: 'xtream-1',
                title: 'Xtream Playlist',
                count: 2,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://example.com',
            },
        ]);

        await service.reloadGlobalFavorites();

        const liveOnly = service.globalFavoriteLiveItems();
        // Includes the Xtream "Favorite Channel HD" plus the two M3U live
        // favorites already seeded by the default fixture.
        expect(liveOnly.map((it) => it.title)).toEqual(
            expect.arrayContaining([
                'Favorite Channel HD',
                'Channel One',
                'Channel Two',
            ])
        );

        // Crucially, the movie favorite is excluded — the rail source must
        // never leak VOD posters into the channel layout.
        expect(liveOnly.map((it) => it.title)).not.toContain(
            'Favorite Movie'
        );
        expect(
            service.globalFavoriteLiveItems().every((it) => it.type === 'live')
        ).toBe(true);
    });

    it('returns null playback position for live channels (no position tracking in schema)', async () => {
        // The default M3U playlist contains a live channel. Without
        // reloading playback positions the lookup still gracefully returns
        // null — and `reloadPlaybackPositions` should skip the IPC entirely.
        const liveItem = service
            .globalRecentItems()
            .find((item) => item.type === 'live');
        expect(liveItem).toBeDefined();
        expect(service.getPlaybackPositionForItem(liveItem!)).toBeNull();

        await service.reloadPlaybackPositions();
        expect(
            playbackPositionsMock.getAllPlaybackPositions
        ).not.toHaveBeenCalled();
    });

    it('prioritizes recently used Xtream sources over newer imported M3U sources', async () => {
        playlistsSignal.set([
            {
                _id: 'm3u-fresh',
                title: 'Fresh Import',
                count: 1,
                importDate: '2026-04-20T12:00:00.000Z',
                autoRefresh: false,
                favorites: [],
                recentlyViewed: [],
            },
            {
                _id: 'xtream-1',
                title: 'Xtream Playlist',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://example.com',
            },
        ]);
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([
            {
                id: 91,
                category_id: 18,
                title: 'Recent Movie',
                rating: '7.8',
                viewed_at: '2026-04-21T10:00:00.000Z',
                poster_url: 'https://example.com/recent-movie.png',
                xtream_id: 7001,
                type: 'movie',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);

        await service.reloadGlobalRecentItems();

        expect(
            service.recentPlaylists().map((playlist) => playlist._id)
        ).toEqual(['xtream-1', 'm3u-fresh']);
    });

    it('includes M3U, Xtream, and Stalker sources when all have recent activity', async () => {
        playlistsSignal.set([
            {
                _id: 'm3u-1',
                title: 'M3U Playlist',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                favorites: [],
                recentlyViewed: [
                    {
                        source: 'm3u',
                        id: 'https://example.com/stream-1.m3u8',
                        url: 'https://example.com/stream-1.m3u8',
                        title: 'Channel One',
                        category_id: 'live',
                        added_at: '2026-04-19T10:00:00.000Z',
                    },
                ],
            },
            {
                _id: 'stalker-1',
                title: 'Stalker Playlist',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                macAddress: '00:11:22:33:44:55',
                recentlyViewed: [
                    {
                        id: 'stalker-item-1',
                        name: 'Stalker Movie',
                        category_id: 'vod',
                        added_at: '2026-04-20T10:00:00.000Z',
                    },
                ],
            },
            {
                _id: 'xtream-1',
                title: 'Xtream Playlist',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://example.com',
            },
        ]);
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([
            {
                id: 91,
                category_id: 18,
                title: 'Recent Movie',
                rating: '7.8',
                viewed_at: '2026-04-21T10:00:00.000Z',
                poster_url: 'https://example.com/recent-movie.png',
                xtream_id: 7001,
                type: 'movie',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);

        await service.reloadGlobalRecentItems();

        expect(
            service.recentPlaylists().map((playlist) => playlist._id)
        ).toEqual(['xtream-1', 'stalker-1', 'm3u-1']);
    });

    it('includes PWA Xtream recent items from the active data source', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        xtreamDataSourceMock.getRecentItems.mockResolvedValue([
            {
                id: 91,
                category_id: 18,
                title: 'Recent Movie',
                rating: '7.8',
                viewed_at: '2026-04-21T10:00:00.000Z',
                poster_url: 'https://example.com/recent-movie.png',
                xtream_id: 7001,
                type: 'movie',
            },
        ]);

        await service.reloadGlobalRecentItems();

        expect(xtreamDataSourceMock.getRecentItems).toHaveBeenCalledWith(
            'xtream-1'
        );
        expect(dbServiceMock.getGlobalRecentlyViewed).not.toHaveBeenCalled();
        expect(service.globalRecentItems()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 91,
                    title: 'Recent Movie',
                    type: 'movie',
                    playlist_id: 'xtream-1',
                    playlist_name: 'Xtream Playlist',
                    source: 'xtream',
                    viewed_at: '2026-04-21T10:00:00.000Z',
                }),
            ])
        );
    });

    it('loads PWA Xtream recent items for multiple playlists in parallel', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        playlistsSignal.set([
            {
                _id: 'xtream-1',
                title: 'Xtream One',
                serverUrl: 'https://one.example.com',
            },
            {
                _id: 'xtream-2',
                title: 'Xtream Two',
                serverUrl: 'https://two.example.com',
            },
        ]);
        const firstRecentItems = createPendingItems();
        xtreamDataSourceMock.getRecentItems.mockImplementation((playlistId) =>
            playlistId === 'xtream-1'
                ? firstRecentItems.promise
                : Promise.resolve([])
        );

        const reload = service.reloadGlobalRecentItems();
        await Promise.resolve();

        expect(xtreamDataSourceMock.getRecentItems).toHaveBeenCalledWith(
            'xtream-1'
        );
        expect(xtreamDataSourceMock.getRecentItems).toHaveBeenCalledWith(
            'xtream-2'
        );

        firstRecentItems.resolve([]);
        await reload;
    });

    it('does not load Stalker playlists through the PWA Xtream recent path', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        playlistsSignal.set([
            {
                _id: 'xtream-1',
                title: 'Xtream Playlist',
                serverUrl: 'https://xtream.example.com',
            },
            {
                _id: 'stalker-1',
                title: 'Stalker Playlist',
                serverUrl: 'https://stalker.example.com',
                macAddress: '00:11:22:33:44:55',
            },
        ]);

        await service.reloadGlobalRecentItems();

        expect(xtreamDataSourceMock.getRecentItems).toHaveBeenCalledTimes(1);
        expect(xtreamDataSourceMock.getRecentItems).toHaveBeenCalledWith(
            'xtream-1'
        );
    });

    it('falls back to playlist metadata ordering when sources have no recent activity', async () => {
        playlistsSignal.set([
            {
                _id: 'xtream-1',
                title: 'Xtream Playlist',
                count: 1,
                importDate: '2026-01-01T00:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://example.com',
            },
            {
                _id: 'stalker-1',
                title: 'Stalker Playlist',
                count: 1,
                importDate: '2026-03-01T00:00:00.000Z',
                autoRefresh: false,
                macAddress: '00:11:22:33:44:55',
                recentlyViewed: [],
            },
            {
                _id: 'm3u-1',
                title: 'M3U Playlist',
                count: 1,
                importDate: '2026-02-01T00:00:00.000Z',
                updateDate: Date.parse('2026-04-01T00:00:00.000Z'),
                autoRefresh: false,
                favorites: [],
                recentlyViewed: [],
            },
        ]);
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([]);

        await service.reloadGlobalRecentItems();

        expect(
            service.recentPlaylists().map((playlist) => playlist._id)
        ).toEqual(['m3u-1', 'stalker-1', 'xtream-1']);
    });

    it('maps recently added Xtream rows for the widget', async () => {
        dbServiceMock.getGlobalRecentlyAdded.mockResolvedValue([
            {
                id: 11,
                category_id: 77,
                title: 'Fresh Movie',
                rating: '8.1',
                added: '1774298340',
                added_at: '1774298340',
                poster_url: 'https://example.com/poster.png',
                xtream_id: 501,
                type: 'movie',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);

        await expect(
            service.getGlobalRecentlyAddedItems('all', 25)
        ).resolves.toEqual([
            expect.objectContaining({
                id: 11,
                title: 'Fresh Movie',
                type: 'movie',
                playlist_id: 'xtream-1',
                source: 'xtream',
                added_at: expect.any(String),
            }),
        ]);
        expect(dbServiceMock.getGlobalRecentlyAdded).toHaveBeenCalledWith(
            'all',
            25
        );
    });

    it('builds the Xtream recently added route', () => {
        const item = {
            id: 11,
            title: 'Fresh Series',
            type: 'series',
            playlist_id: 'xtream-1',
            playlist_name: 'Xtream Playlist',
            added_at: '2026-03-27T14:39:00.000Z',
            category_id: 77,
            xtream_id: 501,
            poster_url: 'https://example.com/poster.png',
            source: 'xtream',
        } as const;

        expect(service.getRecentlyAddedLink(item)).toEqual([
            '/workspace',
            'xtreams',
            'xtream-1',
            'series',
            '77',
            '501',
        ]);
        expect(service.getRecentlyAddedNavigationState(item)).toBeUndefined();
    });

    it('builds the M3U recent route with collection auto-open state', () => {
        const m3uItem = service
            .globalRecentItems()
            .find((item) => item.source === 'm3u');

        expect(m3uItem).toBeDefined();
        expect(service.getRecentItemLink(m3uItem!)).toEqual([
            '/workspace',
            'playlists',
            'm3u-1',
            'recent',
        ]);
        expect(service.getRecentItemNavigationState(m3uItem!)).toEqual({
            openLiveCollectionItem: {
                contentType: 'live',
                sourceType: 'm3u',
                playlistId: 'm3u-1',
                itemId: 'https://example.com/stream-1.m3u8',
                title: 'Channel One',
                imageUrl: 'https://example.com/logo-1.png',
            },
        });
    });

    it('routes Xtream non-live recents through the global recent page with inline detail state', async () => {
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([
            {
                id: 91,
                category_id: 18,
                title: 'Recent Movie',
                rating: '7.8',
                viewed_at: '2026-02-04T10:00:00.000Z',
                poster_url: 'https://example.com/recent-movie.png',
                backdrop_url: 'https://example.com/recent-movie-backdrop.png',
                xtream_id: 7001,
                type: 'movie',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);

        await service.reloadGlobalRecentItems();
        const movieItem = service
            .globalRecentItems()
            .find((item) => item.source === 'xtream');

        expect(movieItem).toEqual(
            expect.objectContaining({
                backdrop_url: 'https://example.com/recent-movie-backdrop.png',
            })
        );
        expect(service.getRecentItemLink(movieItem!)).toEqual([
            '/workspace',
            'global-recent',
        ]);
        expect(service.getRecentItemNavigationState(movieItem!)).toEqual({
            openCollectionDetailItem: {
                item: expect.objectContaining({
                    uid: 'xtream::xtream-1::movie:7001',
                    name: 'Recent Movie',
                    contentType: 'movie',
                    sourceType: 'xtream',
                    playlistId: 'xtream-1',
                }),
            },
        });
    });

    it('normalizes SQLite-style Xtream recent timestamps before sorting and rendering', async () => {
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([
            {
                id: 91,
                category_id: 18,
                title: 'Recent Movie',
                rating: '7.8',
                viewed_at: '2026-02-04 10:00:00',
                poster_url: 'https://example.com/recent-movie.png',
                xtream_id: 7001,
                type: 'movie',
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream Playlist',
            },
        ]);

        await service.reloadGlobalRecentItems();
        const movieItem = service
            .globalRecentItems()
            .find((item) => item.source === 'xtream');

        expect(movieItem).toEqual(
            expect.objectContaining({
                viewed_at: '2026-02-04T10:00:00.000Z',
            })
        );
    });

    it('removes M3U recently viewed via PlaylistsService', async () => {
        const m3uItem = service
            .globalRecentItems()
            .find((item) => item.source === 'm3u');

        expect(m3uItem).toBeDefined();

        await service.removeGlobalRecentItem(m3uItem!);

        expect(
            playlistsServiceMock.removeFromM3uRecentlyViewed
        ).toHaveBeenCalledWith('m3u-1', 'https://example.com/stream-1.m3u8');
    });

    it('removes PWA Xtream recently viewed through the active data source', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        const item = {
            id: 91,
            category_id: 18,
            title: 'Recent Movie',
            viewed_at: '2026-04-21T10:00:00.000Z',
            poster_url: 'https://example.com/recent-movie.png',
            xtream_id: 7001,
            type: 'movie',
            playlist_id: 'xtream-1',
            playlist_name: 'Xtream Playlist',
            source: 'xtream',
        } satisfies GlobalRecentItem;

        await service.removeGlobalRecentItem(item);

        expect(xtreamDataSourceMock.removeRecentItem).toHaveBeenCalledWith(
            91,
            'xtream-1'
        );
        expect(dbServiceMock.removeRecentItem).not.toHaveBeenCalled();
        expect(xtreamDataSourceMock.getRecentItems).toHaveBeenCalledWith(
            'xtream-1'
        );
    });
});
