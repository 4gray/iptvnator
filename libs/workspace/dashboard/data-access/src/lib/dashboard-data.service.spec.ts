import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { selectAllPlaylistsMeta } from 'm3u-state';
import { of } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import { Playlist, PlaylistMeta } from 'shared-interfaces';
import { DashboardDataService } from './dashboard-data.service';

describe('DashboardDataService', () => {
    let service: DashboardDataService;

    const playlistsSignal = signal<PlaylistMeta[]>([
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
    ]);

    const storeMock = {
        selectSignal: jest.fn((selector: unknown) => {
            if (selector === selectAllPlaylistsMeta) {
                return playlistsSignal;
            }
            return signal(null);
        }),
        dispatch: jest.fn(),
    };

    const dbServiceMock = {
        getGlobalRecentlyAdded: jest.fn().mockResolvedValue([]),
        getGlobalRecentlyViewed: jest.fn().mockResolvedValue([]),
        getGlobalFavorites: jest.fn().mockResolvedValue([]),
        removeFromFavorites: jest.fn().mockResolvedValue(undefined),
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
        getPlaylistById: jest.fn().mockReturnValue(of(playlistMock)),
        setFavorites: jest.fn().mockReturnValue(of(undefined)),
        removeFromM3uRecentlyViewed: jest
            .fn()
            .mockReturnValue(
                of({
                    ...playlistMock,
                    recentlyViewed: [],
                })
            ),
    };

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            value: {} as Window['electron'],
            configurable: true,
        });
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
        dbServiceMock.getGlobalFavorites.mockClear();
        dbServiceMock.getGlobalFavorites.mockResolvedValue([]);
        dbServiceMock.getGlobalRecentlyAdded.mockClear();
        dbServiceMock.getGlobalRecentlyAdded.mockResolvedValue([]);
        dbServiceMock.getGlobalRecentlyViewed.mockClear();
        dbServiceMock.getGlobalRecentlyViewed.mockResolvedValue([]);
        dbServiceMock.removeFromFavorites.mockClear();
        dbServiceMock.removeRecentItem.mockClear();
        storeMock.dispatch.mockClear();

        TestBed.configureTestingModule({
            providers: [
                DashboardDataService,
                { provide: Store, useValue: storeMock },
                { provide: DatabaseService, useValue: dbServiceMock },
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
            ],
        });
        service = TestBed.inject(DashboardDataService);
    });

    afterEach(() => {
        jest.clearAllMocks();
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
                }),
                expect.objectContaining({
                    id: 'https://example.com/stream-2.m3u8',
                    title: 'Channel Two',
                    type: 'live',
                    playlist_id: 'm3u-1',
                    source: 'm3u',
                    poster_url: 'https://example.com/logo-2.png',
                }),
            ])
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
                }),
            ])
        );
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

    it('builds the M3U recent route with navigation state', () => {
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
            openRecentChannelUrl: 'https://example.com/stream-1.m3u8',
        });
    });

    it('removes M3U recently viewed via PlaylistsService', async () => {
        const m3uItem = service
            .globalRecentItems()
            .find((item) => item.source === 'm3u');

        expect(m3uItem).toBeDefined();

        await service.removeGlobalRecentItem(m3uItem!);

        expect(
            playlistsServiceMock.removeFromM3uRecentlyViewed
        ).toHaveBeenCalledWith(
            'm3u-1',
            'https://example.com/stream-1.m3u8'
        );
    });
});
