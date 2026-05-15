import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { DataService, PlaylistsService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { UnifiedCollectionItem } from './unified-collection-item.interface';
import {
    ResolvedLiveCollectionDetail,
    StreamResolverService,
} from './stream-resolver.service';

describe('StreamResolverService', () => {
    let service: StreamResolverService;
    let playlistsService: { getPlaylistById: jest.Mock };
    let xtreamApi: { getShortEpg: jest.Mock };
    let xtreamUrl: { constructLiveUrl: jest.Mock };
    let dataService: { sendIpcEvent: jest.Mock };
    let stalkerSession: { makeAuthenticatedRequest: jest.Mock };

    beforeEach(() => {
        playlistsService = {
            getPlaylistById: jest.fn(),
        };
        xtreamApi = {
            getShortEpg: jest.fn(),
        };
        xtreamUrl = {
            constructLiveUrl: jest.fn(),
        };
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        stalkerSession = {
            makeAuthenticatedRequest: jest.fn(),
        };

        window.electron = {
            ...window.electron,
            getChannelPrograms: jest.fn(),
        } as typeof window.electron;

        TestBed.configureTestingModule({
            providers: [
                StreamResolverService,
                { provide: PlaylistsService, useValue: playlistsService },
                { provide: XtreamApiService, useValue: xtreamApi },
                { provide: XtreamUrlService, useValue: xtreamUrl },
                { provide: DataService, useValue: dataService },
                { provide: StalkerSessionService, useValue: stalkerSession },
            ],
        });

        service = TestBed.inject(StreamResolverService);
    });

    it('returns M3U live detail with the full channel and raw EPG programs', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'm3u-1',
                playlist: {
                    items: [
                        {
                            id: 'channel-1',
                            name: 'News',
                            url: 'https://example.com/live.m3u8',
                            group: { title: 'News' },
                            tvg: {
                                id: 'news-id',
                                name: 'News',
                                url: '',
                                logo: 'news.png',
                                rec: '',
                            },
                            http: {
                                referrer: 'https://ref.example.com',
                                'user-agent': 'IPTVnator',
                                origin: 'https://origin.example.com',
                            },
                            radio: 'false',
                            epgParams: '',
                        },
                    ],
                },
            } satisfies Partial<Playlist>)
        );
        (window.electron.getChannelPrograms as jest.Mock).mockResolvedValue([
            {
                start: '2026-03-26T11:00:00.000Z',
                stop: '2026-03-26T12:00:00.000Z',
                channel: 'news-id',
                title: 'Morning News',
                desc: 'Latest headlines',
                category: null,
            },
        ]);

        const detail = await service.resolveLiveDetail({
            uid: 'm3u::m3u-1::https://example.com/live.m3u8',
            name: 'News',
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'm3u-1',
            playlistName: 'M3U List',
            streamUrl: 'https://example.com/live.m3u8',
            channelId: 'channel-1',
            tvgId: 'news-id',
            logo: 'news.png',
        } satisfies UnifiedCollectionItem);

        expect(detail).toMatchObject<Partial<ResolvedLiveCollectionDetail>>({
            epgMode: 'm3u',
            channel: expect.objectContaining({
                id: 'channel-1',
                url: 'https://example.com/live.m3u8',
            }),
            playback: expect.objectContaining({
                streamUrl: 'https://example.com/live.m3u8',
                userAgent: 'IPTVnator',
                referer: 'https://ref.example.com',
                origin: 'https://origin.example.com',
            }),
        });
        expect(detail.epgPrograms).toHaveLength(1);
    });

    it('resolves M3U playback detail without blocking on channel-program lookup', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'm3u-1',
                playlist: {
                    items: [
                        {
                            id: 'channel-1',
                            name: 'News',
                            url: 'https://example.com/live.m3u8',
                            group: { title: 'News' },
                            tvg: {
                                id: 'news-id',
                                name: 'News',
                                url: '',
                                logo: 'news.png',
                                rec: '',
                            },
                            http: {
                                referrer: 'https://ref.example.com',
                                'user-agent': 'IPTVnator',
                                origin: 'https://origin.example.com',
                            },
                            radio: 'false',
                            epgParams: '',
                        },
                    ],
                },
            } satisfies Partial<Playlist>)
        );

        const detail = await service.resolveM3uPlaybackDetail({
            uid: 'm3u::m3u-1::https://example.com/live.m3u8',
            name: 'News',
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'm3u-1',
            playlistName: 'M3U List',
            streamUrl: 'https://example.com/live.m3u8',
            channelId: 'channel-1',
            tvgId: 'news-id',
            logo: 'news.png',
        } satisfies UnifiedCollectionItem);

        expect(detail.playback.streamUrl).toBe('https://example.com/live.m3u8');
        expect(detail.epgPrograms).toEqual([]);
        expect(window.electron.getChannelPrograms).not.toHaveBeenCalled();
    });

    it('preserves the radio flag when M3U playback falls back to item metadata', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'm3u-1',
                playlist: {
                    items: [],
                },
            } satisfies Partial<Playlist>)
        );

        const detail = await service.resolveM3uPlaybackDetail({
            uid: 'm3u::m3u-1::radio-channel',
            name: 'Radio Channel',
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'm3u-1',
            playlistName: 'M3U List',
            streamUrl: 'https://example.com/radio.m3u8',
            channelId: 'radio-channel',
            tvgId: 'radio-id',
            logo: 'radio.png',
            radio: 'true',
        } satisfies UnifiedCollectionItem);

        expect(detail.channel).toMatchObject({
            id: 'radio-channel',
            url: 'https://example.com/radio.m3u8',
            radio: 'true',
        });
    });

    it('returns Xtream live detail with shared EPG items', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'xtream-1',
                serverUrl: 'https://xtream.example.com',
                username: 'user',
                password: 'pass',
            } satisfies Partial<Playlist>)
        );
        xtreamUrl.constructLiveUrl.mockReturnValue(
            'https://xtream.example.com/live/1'
        );
        xtreamApi.getShortEpg.mockResolvedValue([
            {
                id: '1',
                epg_id: '',
                title: 'Xtream Show',
                description: 'Current Xtream program',
                lang: '',
                start: '2026-03-26T11:00:00.000Z',
                end: '2026-03-26T12:00:00.000Z',
                stop: '2026-03-26T12:00:00.000Z',
                channel_id: '1',
                start_timestamp: '1774522800',
                stop_timestamp: '1774526400',
            },
        ]);

        const detail = await service.resolveLiveDetail({
            uid: 'xtream::xtream-1::1',
            name: 'Xtream Live',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'xtream-1',
            playlistName: 'Xtream',
            xtreamId: 1,
            logo: 'xtream.png',
        } satisfies UnifiedCollectionItem);

        expect(detail.epgMode).toBe('portal');
        expect(detail.playback.streamUrl).toBe(
            'https://xtream.example.com/live/1'
        );
        expect(detail.epgItems).toHaveLength(1);
        expect(xtreamApi.getShortEpg).toHaveBeenCalledWith(
            {
                serverUrl: 'https://xtream.example.com',
                username: 'user',
                password: 'pass',
            },
            1,
            10,
            {
                suppressErrorLog: true,
            }
        );
    });

    it('reuses cached empty Xtream preview EPG results instead of refetching immediately', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'xtream-1',
                serverUrl: 'https://xtream.example.com',
                username: 'user',
                password: 'pass',
            } satisfies Partial<Playlist>)
        );
        xtreamApi.getShortEpg.mockResolvedValue([]);

        const items = [
            {
                uid: 'xtream::xtream-1::1',
                name: 'Xtream Live',
                contentType: 'live',
                sourceType: 'xtream',
                playlistId: 'xtream-1',
                playlistName: 'Xtream',
                xtreamId: 1,
            } satisfies UnifiedCollectionItem,
        ];

        await service.loadEpgForItems(items);
        await service.loadEpgForItems(items);

        expect(xtreamApi.getShortEpg).toHaveBeenCalledTimes(1);
        expect(xtreamApi.getShortEpg).toHaveBeenCalledWith(
            {
                serverUrl: 'https://xtream.example.com',
                username: 'user',
                password: 'pass',
            },
            1,
            2,
            {
                suppressErrorLog: true,
            }
        );
    });

    it('backs off repeated Xtream detail EPG failures during the cooldown window', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'xtream-1',
                serverUrl: 'https://xtream.example.com',
                username: 'user',
                password: 'pass',
            } satisfies Partial<Playlist>)
        );
        xtreamUrl.constructLiveUrl.mockReturnValue(
            'https://xtream.example.com/live/1'
        );
        xtreamApi.getShortEpg.mockRejectedValue(new Error('EPG failed'));

        const item = {
            uid: 'xtream::xtream-1::1',
            name: 'Xtream Live',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'xtream-1',
            playlistName: 'Xtream',
            xtreamId: 1,
        } satisfies UnifiedCollectionItem;

        const firstDetail = await service.resolveLiveDetail(item);
        const secondDetail = await service.resolveLiveDetail(item);

        expect(firstDetail.epgItems).toEqual([]);
        expect(secondDetail.epgItems).toEqual([]);
        expect(xtreamApi.getShortEpg).toHaveBeenCalledTimes(1);
    });

    it('falls back to empty Xtream EPG when the provider response is too slow', async () => {
        jest.useFakeTimers();

        try {
            playlistsService.getPlaylistById.mockReturnValue(
                of({
                    _id: 'xtream-1',
                    serverUrl: 'https://xtream.example.com',
                    username: 'user',
                    password: 'pass',
                } satisfies Partial<Playlist>)
            );
            xtreamUrl.constructLiveUrl.mockReturnValue(
                'https://xtream.example.com/live/1'
            );
            xtreamApi.getShortEpg.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        setTimeout(
                            () =>
                                resolve([
                                    {
                                        id: '1',
                                        epg_id: '',
                                        title: 'Late Xtream Show',
                                        description: 'Delayed Xtream program',
                                        lang: '',
                                        start: '2026-03-26T11:00:00.000Z',
                                        end: '2026-03-26T12:00:00.000Z',
                                        stop: '2026-03-26T12:00:00.000Z',
                                        channel_id: '1',
                                        start_timestamp: '1774522800',
                                        stop_timestamp: '1774526400',
                                    },
                                ]),
                            10_000
                        );
                    })
            );

            const detailPromise = service.resolveLiveDetail({
                uid: 'xtream::xtream-1::1',
                name: 'Xtream Live',
                contentType: 'live',
                sourceType: 'xtream',
                playlistId: 'xtream-1',
                playlistName: 'Xtream',
                xtreamId: 1,
            } satisfies UnifiedCollectionItem);

            await jest.advanceTimersByTimeAsync(3000);

            await expect(detailPromise).resolves.toMatchObject({
                epgMode: 'portal',
                playback: expect.objectContaining({
                    streamUrl: 'https://xtream.example.com/live/1',
                }),
                epgItems: [],
            });
        } finally {
            jest.useRealTimers();
        }
    });

    it('loads current Stalker EPG previews for live collection rows', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );
        dataService.sendIpcEvent.mockResolvedValue({
            js: [
                {
                    id: '10',
                    name: 'Stalker Live',
                    descr: 'Current Stalker program',
                    time: '2026-03-26T11:00:00.000Z',
                    time_to: '2026-03-26T12:00:00.000Z',
                    ch_id: '77',
                    start_timestamp: String(Math.floor(Date.now() / 1000) - 60),
                    stop_timestamp: String(Math.floor(Date.now() / 1000) + 60),
                },
            ],
        });

        const epgMap = await service.loadEpgForItems([
            {
                uid: 'stalker::stalker-1::77',
                name: 'Stalker Channel',
                contentType: 'live',
                sourceType: 'stalker',
                playlistId: 'stalker-1',
                playlistName: 'Stalker',
                stalkerId: '77',
                tvgId: '77',
                stalkerCmd: 'ffmpeg http://stalker/77',
            } satisfies UnifiedCollectionItem,
        ]);

        expect(epgMap.get('77')).toMatchObject({
            title: 'Stalker Live',
            channel: '77',
        });
    });

    it('resolves Stalker radio collection items with radio playback and no EPG request', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com/portal.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                cmd: 'ffmpeg https://media.example.com/jazz.mp3',
            },
        });

        const detail = await service.resolveLiveDetail({
            uid: 'stalker::stalker-1::40001',
            name: 'Jazz Radio',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '40001',
            stalkerCmd: 'ffrt4://radio/40001/index.mp3',
            logo: 'jazz.png',
            radio: 'true',
        } satisfies UnifiedCollectionItem);

        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(1);
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: 'create_link',
                    type: 'radio',
                    cmd: 'ffrt4://radio/40001/index.mp3',
                }),
            })
        );
        expect(detail).toEqual(
            expect.objectContaining({
                epgMode: 'portal',
                epgItems: [],
                channel: expect.objectContaining({
                    id: '40001',
                    name: 'Jazz Radio',
                    radio: 'true',
                }),
                playback: expect.objectContaining({
                    streamUrl: 'https://media.example.com/jazz.mp3',
                    title: 'Jazz Radio',
                    thumbnail: 'jazz.png',
                }),
            })
        );
    });

    it('uses direct Stalker radio HTTP commands without create_link', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com/portal.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
                userAgent: 'IPTVnator',
                referrer: 'https://ref.example.com',
                origin: 'https://origin.example.com',
            } satisfies Partial<Playlist>)
        );

        const detail = await service.resolveLiveDetail({
            uid: 'stalker::stalker-1::40002',
            name: 'Direct Radio',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '40002',
            stalkerCmd: 'ffmpeg https://media.example.com/direct-radio.mp3',
            logo: 'direct-radio.png',
            radio: 'true',
        } satisfies UnifiedCollectionItem);

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(stalkerSession.makeAuthenticatedRequest).not.toHaveBeenCalled();
        expect(detail).toEqual(
            expect.objectContaining({
                epgMode: 'portal',
                epgItems: [],
                channel: expect.objectContaining({
                    id: '40002',
                    name: 'Direct Radio',
                    radio: 'true',
                    url: 'https://media.example.com/direct-radio.mp3',
                    http: expect.objectContaining({
                        referrer: 'https://ref.example.com',
                        'user-agent': 'IPTVnator',
                        origin: 'https://origin.example.com',
                    }),
                }),
                playback: expect.objectContaining({
                    streamUrl: 'https://media.example.com/direct-radio.mp3',
                    title: 'Direct Radio',
                    thumbnail: 'direct-radio.png',
                    userAgent: 'IPTVnator',
                    referer: 'https://ref.example.com',
                    origin: 'https://origin.example.com',
                }),
            })
        );
    });
});
