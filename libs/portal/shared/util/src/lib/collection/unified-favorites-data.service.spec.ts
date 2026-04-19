import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import {
    Channel,
    Playlist,
    PlaylistMeta,
    StalkerPortalItem,
} from 'shared-interfaces';
import { UnifiedCollectionItem } from './unified-collection-item.interface';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';

describe('UnifiedFavoritesDataService', () => {
    let service: UnifiedFavoritesDataService;
    let electronApi: {
        dbGetAllGlobalFavorites: jest.Mock;
        dbRemoveFavorite: jest.Mock;
    };
    let databaseService: {
        getAllGlobalFavorites: jest.Mock;
        getFavorites: jest.Mock;
    };
    let playlistsService: {
        getPlaylistById: jest.Mock;
        setFavorites: jest.Mock;
        setPortalFavorites: jest.Mock;
    };

    const m3uChannels: Channel[] = [
        {
            id: 'channel-1',
            name: 'Channel One',
            url: 'https://example.com/1.m3u8',
            group: { title: 'News' },
            tvg: {
                id: 'one',
                name: 'Channel One',
                url: '',
                logo: 'one.png',
                rec: '',
            },
            http: { referrer: '', 'user-agent': '', origin: '' },
            radio: 'false',
            epgParams: '',
        },
        {
            id: 'channel-2',
            name: 'Channel Two',
            url: 'https://example.com/2.m3u8',
            group: { title: 'Sports' },
            tvg: {
                id: 'two',
                name: 'Channel Two',
                url: '',
                logo: 'two.png',
                rec: '',
            },
            http: { referrer: '', 'user-agent': '', origin: '' },
            radio: 'true',
            epgParams: '',
        },
    ];

    const stalkerFavorites: StalkerPortalItem[] = [
        {
            id: '101',
            title: 'Stalker One',
            category_id: 'itv',
            cmd: 'ffmpeg http://stalker/101',
            logo: 'one.png',
            added_at: '2026-03-26T10:00:00.000Z',
        },
        {
            id: '202',
            title: 'Stalker Two',
            category_id: 'itv',
            cmd: 'ffmpeg http://stalker/202',
            logo: 'two.png',
            added_at: '2026-03-26T11:00:00.000Z',
        },
    ];

    beforeEach(() => {
        electronApi = {
            dbGetAllGlobalFavorites: jest.fn(),
            dbRemoveFavorite: jest.fn().mockResolvedValue(undefined),
        };
        Object.defineProperty(window, 'electron', {
            value: electronApi as Window['electron'],
            configurable: true,
        });

        playlistsService = {
            getPlaylistById: jest.fn(),
            setFavorites: jest.fn().mockReturnValue(of({})),
            setPortalFavorites: jest.fn().mockReturnValue(of({})),
        };
        databaseService = {
            getAllGlobalFavorites: jest.fn().mockResolvedValue([]),
            getFavorites: jest.fn().mockResolvedValue([]),
        };

        TestBed.configureTestingModule({
            providers: [
                UnifiedFavoritesDataService,
                {
                    provide: Store,
                    useValue: {
                        select: jest.fn(() =>
                            of([
                                {
                                    _id: 'm3u-1',
                                    title: 'M3U List',
                                    favorites: [
                                        'https://example.com/2.m3u8',
                                        'channel-1',
                                    ],
                                },
                                {
                                    _id: 'stalker-1',
                                    title: 'Stalker List',
                                    macAddress: '00:11:22:33:44:55',
                                    favorites: stalkerFavorites,
                                },
                            ] satisfies PlaylistMeta[])
                        ),
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: PlaylistsService,
                    useValue: playlistsService,
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                    },
                },
            ],
        });

        service = TestBed.inject(UnifiedFavoritesDataService);
    });

    it('maps global Xtream favorites across live, movie, and series content types', async () => {
        databaseService.getAllGlobalFavorites.mockResolvedValue([
            {
                id: 10,
                category_id: 1,
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream One',
                xtream_id: 101,
                title: 'Live One',
                type: 'live',
                poster_url: 'live.png',
                added_at: '2026-03-26T09:00:00.000Z',
                position: 0,
            },
            {
                id: 11,
                category_id: 2,
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream One',
                xtream_id: 102,
                title: 'Movie One',
                type: 'movie',
                poster_url: 'movie.png',
                added_at: '2026-03-26T08:00:00.000Z',
                position: 1,
            },
            {
                id: 12,
                category_id: 3,
                playlist_id: 'xtream-1',
                playlist_name: 'Xtream One',
                xtream_id: 103,
                title: 'Series One',
                type: 'series',
                poster_url: 'series.png',
                added_at: '2026-03-26T07:00:00.000Z',
                position: 2,
            },
        ]);

        const items = await service.getFavorites('all');

        expect(items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'Live One',
                    contentType: 'live',
                    logo: 'live.png',
                    posterUrl: null,
                }),
                expect.objectContaining({
                    name: 'Movie One',
                    contentType: 'movie',
                    logo: null,
                    posterUrl: 'movie.png',
                }),
                expect.objectContaining({
                    name: 'Series One',
                    contentType: 'series',
                    logo: null,
                    posterUrl: 'series.png',
                }),
            ])
        );
    });

    it('preserves persisted M3U favorites order when extracting playlist favorites', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'm3u-1',
                favorites: [
                    'https://example.com/2.m3u8',
                    'channel-1',
                ],
                playlist: {
                    items: m3uChannels,
                },
            } satisfies Partial<Playlist>)
        );

        const items = await service.getFavorites('playlist', 'm3u-1', 'm3u');

        expect(items.map((item) => item.streamUrl)).toEqual([
            'https://example.com/2.m3u8',
            'https://example.com/1.m3u8',
        ]);
        expect(items[1].channelId).toBe('channel-1');
        expect(items[0].radio).toBe('true');
    });

    it('persists M3U playlist reorders through setFavorites', async () => {
        const reorderedItems = [
            {
                uid: 'm3u::m3u-1::https://example.com/2.m3u8',
                name: 'Channel Two',
                contentType: 'live',
                sourceType: 'm3u',
                playlistId: 'm3u-1',
                playlistName: 'M3U List',
                streamUrl: 'https://example.com/2.m3u8',
                channelId: 'channel-2',
            },
            {
                uid: 'm3u::m3u-1::https://example.com/1.m3u8',
                name: 'Channel One',
                contentType: 'live',
                sourceType: 'm3u',
                playlistId: 'm3u-1',
                playlistName: 'M3U List',
                streamUrl: 'https://example.com/1.m3u8',
                channelId: 'channel-1',
            },
        ] satisfies UnifiedCollectionItem[];

        await service.reorder(reorderedItems, {
            scope: 'playlist',
            playlistId: 'm3u-1',
            portalType: 'm3u',
        });

        expect(playlistsService.setFavorites).toHaveBeenCalledWith('m3u-1', [
            'https://example.com/2.m3u8',
            'https://example.com/1.m3u8',
        ]);
    });

    it('persists Stalker playlist reorders through setPortalFavorites', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                macAddress: '00:11:22:33:44:55',
                favorites: stalkerFavorites,
            } satisfies Partial<Playlist>)
        );

        await service.reorder(
            [
                {
                    uid: 'stalker::stalker-1::202',
                    name: 'Stalker Two',
                    contentType: 'live',
                    sourceType: 'stalker',
                    playlistId: 'stalker-1',
                    playlistName: 'Stalker List',
                    stalkerId: '202',
                },
                {
                    uid: 'stalker::stalker-1::101',
                    name: 'Stalker One',
                    contentType: 'live',
                    sourceType: 'stalker',
                    playlistId: 'stalker-1',
                    playlistName: 'Stalker List',
                    stalkerId: '101',
                },
            ] satisfies UnifiedCollectionItem[],
            {
                scope: 'playlist',
                playlistId: 'stalker-1',
                portalType: 'stalker',
            }
        );

        expect(playlistsService.setPortalFavorites).toHaveBeenCalledWith(
            'stalker-1',
            [stalkerFavorites[1], stalkerFavorites[0]]
        );
    });

    it('clears M3U favorites once per playlist with the remaining favorites preserved', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'm3u-1',
                favorites: [
                    'https://example.com/2.m3u8',
                    'channel-1',
                    'https://example.com/3.m3u8',
                ],
            } satisfies Partial<Playlist>)
        );

        await service.clearFavorites([
            {
                uid: 'm3u::m3u-1::https://example.com/2.m3u8',
                name: 'Channel Two',
                contentType: 'live',
                sourceType: 'm3u',
                playlistId: 'm3u-1',
                playlistName: 'M3U List',
                streamUrl: 'https://example.com/2.m3u8',
                channelId: 'channel-2',
            },
            {
                uid: 'm3u::m3u-1::channel-1',
                name: 'Channel One',
                contentType: 'live',
                sourceType: 'm3u',
                playlistId: 'm3u-1',
                playlistName: 'M3U List',
                streamUrl: 'https://example.com/1.m3u8',
                channelId: 'channel-1',
            },
        ] satisfies UnifiedCollectionItem[]);

        expect(playlistsService.setFavorites).toHaveBeenCalledTimes(1);
        expect(playlistsService.setFavorites).toHaveBeenCalledWith('m3u-1', [
            'https://example.com/3.m3u8',
        ]);
    });

    it('clears Stalker favorites once per playlist with the remaining favorites preserved', async () => {
        const remainingFavorite: StalkerPortalItem = {
            id: '303',
            title: 'Stalker Three',
            category_id: 'itv',
            cmd: 'ffmpeg http://stalker/303',
            logo: 'three.png',
            added_at: '2026-03-26T12:00:00.000Z',
        };
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                macAddress: '00:11:22:33:44:55',
                favorites: [...stalkerFavorites, remainingFavorite],
            } satisfies Partial<Playlist>)
        );

        await service.clearFavorites([
            {
                uid: 'stalker::stalker-1::101',
                name: 'Stalker One',
                contentType: 'live',
                sourceType: 'stalker',
                playlistId: 'stalker-1',
                playlistName: 'Stalker List',
                stalkerId: '101',
            },
            {
                uid: 'stalker::stalker-1::202',
                name: 'Stalker Two',
                contentType: 'live',
                sourceType: 'stalker',
                playlistId: 'stalker-1',
                playlistName: 'Stalker List',
                stalkerId: '202',
            },
        ] satisfies UnifiedCollectionItem[]);

        expect(playlistsService.setPortalFavorites).toHaveBeenCalledTimes(1);
        expect(playlistsService.setPortalFavorites).toHaveBeenCalledWith(
            'stalker-1',
            [remainingFavorite]
        );
    });

    it('clears Xtream favorites through the bulk removal path', async () => {
        await service.clearFavorites([
            {
                uid: 'xtream::xtream-1::101',
                name: 'Xtream One',
                contentType: 'live',
                sourceType: 'xtream',
                playlistId: 'xtream-1',
                playlistName: 'Xtream One',
                xtreamId: 101,
                contentId: 10,
            },
            {
                uid: 'xtream::xtream-1::102',
                name: 'Xtream Two',
                contentType: 'movie',
                sourceType: 'xtream',
                playlistId: 'xtream-1',
                playlistName: 'Xtream One',
                xtreamId: 102,
                contentId: 11,
            },
        ] satisfies UnifiedCollectionItem[]);

        expect(electronApi.dbRemoveFavorite).toHaveBeenCalledTimes(2);
        expect(electronApi.dbRemoveFavorite).toHaveBeenNthCalledWith(
            1,
            10,
            'xtream-1'
        );
        expect(electronApi.dbRemoveFavorite).toHaveBeenNthCalledWith(
            2,
            11,
            'xtream-1'
        );
    });
});
