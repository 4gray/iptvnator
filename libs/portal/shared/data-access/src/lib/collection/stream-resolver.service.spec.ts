import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    StalkerPortalRepairService,
    StalkerSessionService,
} from '@iptvnator/portal/stalker/data-access';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    DataService,
    PlaylistsService,
    SettingsStore,
} from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    ResolvedLiveCollectionDetail,
    StreamResolverService,
} from './stream-resolver.service';

describe('StreamResolverService', () => {
    let service: StreamResolverService;
    let playlistsService: { getPlaylistById: jest.Mock };
    let xtreamApi: { getShortEpg: jest.Mock; getFullEpg: jest.Mock };
    let epgOffsetMinutes = 0;
    let xtreamUrl: { constructLiveUrl: jest.Mock };
    let dataService: { sendIpcEvent: jest.Mock };
    let stalkerSession: {
        getCachedToken: jest.Mock;
        ensureToken: jest.Mock;
        makeAuthenticatedRequest: jest.Mock;
    };
    let epgBridge: Partial<EpgRuntimeBridgeService>;

    beforeEach(() => {
        playlistsService = {
            getPlaylistById: jest.fn(),
        };
        epgOffsetMinutes = 0;
        xtreamApi = {
            getShortEpg: jest.fn(),
            getFullEpg: jest.fn(),
        };
        xtreamUrl = {
            constructLiveUrl: jest.fn(),
        };
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        stalkerSession = {
            getCachedToken: jest.fn(() => null),
            ensureToken: jest.fn().mockResolvedValue({ token: null }),
            makeAuthenticatedRequest: jest.fn(),
        };
        epgBridge = {
            getChannelPrograms: jest.fn(),
            getEpgMapping: jest.fn().mockResolvedValue(null),
            getEpgMappingsBatch: jest.fn().mockResolvedValue(null),
            supportsProgramLookup: true,
        };

        TestBed.configureTestingModule({
            providers: [
                StreamResolverService,
                { provide: PlaylistsService, useValue: playlistsService },
                { provide: XtreamApiService, useValue: xtreamApi },
                { provide: XtreamUrlService, useValue: xtreamUrl },
                { provide: DataService, useValue: dataService },
                {
                    provide: SettingsStore,
                    useValue: {
                        resolvedEpgOffsetMinutes: () => epgOffsetMinutes,
                    },
                },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
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
        (epgBridge.getChannelPrograms as jest.Mock).mockResolvedValue([
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
        expect(epgBridge.getChannelPrograms).toHaveBeenCalledWith('news-id');
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
        expect(epgBridge.getChannelPrograms).not.toHaveBeenCalled();
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
            50,
            {
                suppressErrorLog: true,
            }
        );
    });

    it('skips portal EPG lookups in browser/PWA mode', async () => {
        window.electron = undefined as unknown as typeof window.electron;
        epgBridge.supportsProgramLookup = false;
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
        const item = {
            uid: 'xtream::xtream-1::1',
            name: 'Xtream Live',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'xtream-1',
            playlistName: 'Xtream',
            xtreamId: 1,
            logo: 'xtream.png',
        } satisfies UnifiedCollectionItem;

        const detail = await service.resolveLiveDetail(item);
        const epgMap = await service.loadEpgForItems([item]);

        expect(detail.epgItems).toEqual([]);
        expect(epgMap.size).toBe(0);
        expect(xtreamApi.getShortEpg).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
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
            5,
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
                            30_000
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

            await jest.advanceTimersByTimeAsync(10_000);

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

    it('resolves manual EPG mappings for Xtream previews with one batched lookup', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'xtream-1',
                serverUrl: 'https://xtream.example.com',
                username: 'user',
                password: 'pass',
            } satisfies Partial<Playlist>)
        );

        const nowMs = Date.now();
        epgBridge.getEpgMappingsBatch = jest.fn().mockResolvedValue({
            'xtream:xtream-1:7': 'mapped.channel.id',
        });
        epgBridge.getChannelPrograms = jest.fn().mockResolvedValue([
            {
                channel: 'mapped.channel.id',
                title: 'Mapped Program',
                desc: 'From uploaded XMLTV',
                start: new Date(nowMs - 60_000).toISOString(),
                stop: new Date(nowMs + 60_000).toISOString(),
            },
        ]);

        const epgMap = await service.loadEpgForItems([
            {
                uid: 'xtream::xtream-1::7',
                name: 'Mapped Channel',
                contentType: 'live',
                sourceType: 'xtream',
                playlistId: 'xtream-1',
                playlistName: 'Xtream',
                xtreamId: 7,
            } satisfies UnifiedCollectionItem,
        ]);

        expect(epgBridge.getEpgMappingsBatch).toHaveBeenCalledTimes(1);
        expect(epgBridge.getEpgMappingsBatch).toHaveBeenCalledWith(
            expect.arrayContaining(['xtream:xtream-1:7', 'Mapped Channel'])
        );
        // The mapping resolved via XMLTV, so no provider EPG call is needed.
        expect(xtreamApi.getShortEpg).not.toHaveBeenCalled();
        expect(epgMap.get('Mapped Channel')).toMatchObject({
            title: 'Mapped Program',
        });
    });

    it('resolves manual EPG mappings for Stalker previews without hitting the portal', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );

        const nowMs = Date.now();
        epgBridge.getEpgMappingsBatch = jest.fn().mockResolvedValue({
            'stalker:stalker-1:77': 'mapped.channel.id',
        });
        epgBridge.getChannelPrograms = jest.fn().mockResolvedValue([
            {
                channel: 'mapped.channel.id',
                title: 'Mapped Stalker Program',
                desc: 'From uploaded XMLTV',
                start: new Date(nowMs - 60_000).toISOString(),
                stop: new Date(nowMs + 60_000).toISOString(),
            },
        ]);

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

        expect(epgBridge.getEpgMappingsBatch).toHaveBeenCalledTimes(1);
        expect(epgMap.get('77')).toMatchObject({
            title: 'Mapped Stalker Program',
        });
        // The mapped channel resolves from uploaded XMLTV — the portal
        // short-EPG request must be skipped entirely.
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
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
        // A direct radio URL on a host foreign to the portal gets the
        // credential-free KSPlayer direct-stream profile — the same rule the
        // Stalker live layout applies (the previous playlist-field passthrough
        // predated the shared profile classifier).
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
                        'user-agent': 'KSPlayer',
                    }),
                }),
                playback: expect.objectContaining({
                    streamUrl: 'https://media.example.com/direct-radio.mp3',
                    title: 'Direct Radio',
                    thumbnail: 'direct-radio.png',
                    userAgent: 'KSPlayer',
                }),
            })
        );
        expect(detail.playback.headers?.['Cookie']).toBeUndefined();
        expect(detail.playback.headers?.['Authorization']).toBeUndefined();
    });

    it('plays a legacy radio favorite whose snapshot lost the flags', async () => {
        // The row above this one carries NO `stalkerItem`, so it exercises the
        // missing-snapshot arm. A radio favorite persisted before the flags
        // were carried has a snapshot that simply lacks them — testing
        // presence instead of evidence would skip the radio fallback and start
        // minting for exactly those rows, breaking portals whose radio
        // `create_link` is unsupported.
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com/portal.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );

        const detail = await service.resolveLiveDetail({
            uid: 'stalker::stalker-1::40003',
            name: 'Legacy Radio',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '40003',
            stalkerCmd: 'ffmpeg https://media.example.com/legacy.mp3',
            logo: 'legacy.png',
            radio: 'true',
            // Present, but stripped of the flags by the old whitelist.
            stalkerItem: {
                id: '40003',
                cmd: 'ffmpeg https://media.example.com/legacy.mp3',
                name: 'Legacy Radio',
            },
        } as UnifiedCollectionItem);

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(stalkerSession.makeAuthenticatedRequest).not.toHaveBeenCalled();
        expect(detail.playback.streamUrl).toBe(
            'https://media.example.com/legacy.mp3'
        );
    });

    it('resolves relative Stalker create_link responses against the portal base', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl:
                    'https://stalker.example.com/stalker_portal/server/load.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );
        // Portals frequently answer create_link with a solution-prefixed
        // relative path; the shared normalizer must resolve it instead of
        // handing the bare path to the player (the old weak normalizer did).
        dataService.sendIpcEvent.mockResolvedValue({
            js: { cmd: 'ffmpeg /media/file_123.mpg' },
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::88',
            name: 'Relative Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '88',
            stalkerCmd: 'ffrt3 http://stalker.example.com/media/999.mpg',
        } satisfies UnifiedCollectionItem);

        expect(playback.streamUrl).toBe(
            'https://stalker.example.com/stalker_portal/media/file_123.mpg'
        );
    });

    it('attaches the portal header set to Stalker collection playback on the portal host', async () => {
        // The collection routes must carry the same credentials as the live
        // layout — an auth-gated stream opened from Favorites/Recent 403s
        // without the mac cookie and Bearer token (Codex round-3 finding).
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl:
                    'https://stalker.example.com/stalker_portal/server/load.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: true,
            } satisfies Partial<Playlist>)
        );
        // Playback goes through ensureToken, never the raw cache accessor:
        // that one skips the endpoint/identity/credential check, so an
        // edited playlist would put the old account's token in the headers.
        stalkerSession.ensureToken.mockResolvedValue({ token: 'TOKEN77' });
        stalkerSession.makeAuthenticatedRequest.mockResolvedValue({
            js: { cmd: 'ffmpeg https://stalker.example.com:8080/live/88.ts' },
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::88',
            name: 'Gated Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '88',
            stalkerCmd: 'ffrt3 http://stalker.example.com/media/88.mpg',
        } satisfies UnifiedCollectionItem);

        expect(stalkerSession.ensureToken).toHaveBeenCalled();
        expect(playback.headers?.['Cookie']).toContain(
            'mac=00:11:22:33:44:55'
        );
        expect(playback.headers?.['Authorization']).toBe('Bearer TOKEN77');
        expect(playback.userAgent).toBe(playback.headers?.['User-Agent']);
        expect(playback.referer).toBe('https://stalker.example.com');
        expect(playback.origin).toBe('https://stalker.example.com');
    });

    it('binds the playback token to the endpoint the headers claim', async () => {
        // A completed repair moved the endpoint. The headers are built from
        // that moved endpoint, so the session must be negotiated for it too —
        // authenticating against the pre-repair row would send a token minted
        // for one host to another (and key the session cache differently from
        // every other consumer, forcing a redundant handshake).
        const stored = {
            _id: 'stalker-1',
            portalUrl: 'https://old.example.com/stalker_portal/server/load.php',
            macAddress: '00:11:22:33:44:55',
            isFullStalkerPortal: true,
        } satisfies Partial<Playlist>;
        const repaired =
            'https://new.example.com/stalker_portal/server/load.php';
        playlistsService.getPlaylistById.mockReturnValue(of(stored));
        jest.spyOn(
            TestBed.inject(StalkerPortalRepairService),
            'applyOverride'
        ).mockImplementation(
            (playlist: any) => ({ ...playlist, portalUrl: repaired }) as any
        );
        stalkerSession.ensureToken.mockResolvedValue({ token: 'TOKEN88' });
        stalkerSession.makeAuthenticatedRequest.mockResolvedValue({
            js: { cmd: 'ffmpeg https://new.example.com:8080/live/88.ts' },
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::88',
            name: 'Moved Portal Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '88',
            stalkerCmd: 'ffrt3 http://old.example.com/media/88.mpg',
        } satisfies UnifiedCollectionItem);

        expect(stalkerSession.ensureToken).toHaveBeenCalledWith(
            expect.objectContaining({ portalUrl: repaired })
        );
        expect(playback.headers?.['Authorization']).toBe('Bearer TOKEN88');
        expect(playback.origin).toBe('https://new.example.com');
    });

    it('carries a repaired simple→full mode into the playback headers', async () => {
        // A lazy repair rewrites the portal MODE as well as the URL. The
        // create_link request runs under the repaired mode and adopts a token,
        // so reading the stored row's stale `isFullStalkerPortal: false` when
        // resolving that token would drop the Bearer header from the very
        // playback the repair was meant to rescue.
        const stored = {
            _id: 'stalker-1',
            portalUrl: 'https://portal.example.com/portal.php',
            macAddress: '00:11:22:33:44:55',
            isFullStalkerPortal: false,
        } satisfies Partial<Playlist>;
        playlistsService.getPlaylistById.mockReturnValue(of(stored));
        jest.spyOn(
            TestBed.inject(StalkerPortalRepairService),
            'applyOverride'
        ).mockImplementation(
            (playlist: any) =>
                ({
                    ...playlist,
                    portalUrl:
                        'https://portal.example.com/stalker_portal/server/load.php',
                    isFullStalkerPortal: true,
                }) as any
        );
        stalkerSession.ensureToken.mockResolvedValue({ token: 'REPAIRED77' });
        stalkerSession.makeAuthenticatedRequest.mockResolvedValue({
            js: { cmd: 'ffmpeg https://portal.example.com:8080/live/95.ts' },
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::95',
            name: 'Repaired Portal Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '95',
            stalkerCmd: 'ffrt3 http://portal.example.com/media/95.mpg',
        } satisfies UnifiedCollectionItem);

        expect(stalkerSession.ensureToken).toHaveBeenCalledWith(
            expect.objectContaining({ isFullStalkerPortal: true })
        );
        expect(playback.headers?.['Authorization']).toBe('Bearer REPAIRED77');
    });

    it('authenticates a cold session for a direct-URL radio favorite', async () => {
        // A direct-URL radio favorite skips create_link entirely, so on a
        // cold session nothing has authenticated and the in-memory cache is
        // empty — the Bearer-gated stream would 403 in the audio player.
        // Re-presenting the persisted token costs one idempotent handshake.
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl:
                    'https://stalker.example.com/stalker_portal/server/load.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: true,
                stalkerToken: 'PERSISTED77',
            } satisfies Partial<Playlist>)
        );
        stalkerSession.getCachedToken.mockReturnValue(null);
        stalkerSession.ensureToken.mockResolvedValue({
            token: 'PERSISTED77',
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::99',
            name: 'Gated Radio',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '99',
            radio: 'true',
            stalkerCmd: 'https://stalker.example.com/radio/99.mp3',
        } satisfies UnifiedCollectionItem);

        expect(stalkerSession.ensureToken).toHaveBeenCalled();
        // The fast path must stay a fast path: no create_link round trip.
        expect(stalkerSession.makeAuthenticatedRequest).not.toHaveBeenCalled();
        expect(playback.headers?.['Authorization']).toBe('Bearer PERSISTED77');
    });

    it('falls back to create_link when the cold session cannot be established', async () => {
        // A portal-owned static stream with no usable session would be served
        // knowing it will 401, so playback is not blocked — it takes the
        // `create_link` route instead, which mints a URL carrying its own
        // token and is the only path that can trigger the lazy portal repair.
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl:
                    'https://stalker.example.com/stalker_portal/server/load.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: true,
            } satisfies Partial<Playlist>)
        );
        stalkerSession.getCachedToken.mockReturnValue(null);
        stalkerSession.ensureToken.mockRejectedValue(
            new Error('handshake refused')
        );
        stalkerSession.makeAuthenticatedRequest.mockResolvedValue({
            js: { cmd: 'ffmpeg https://stalker.example.com/radio/99-tmp.mp3' },
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::99',
            name: 'Gated Radio',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '99',
            radio: 'true',
            stalkerCmd: 'https://stalker.example.com/radio/99.mp3',
        } satisfies UnifiedCollectionItem);

        expect(playback.streamUrl).toBe(
            'https://stalker.example.com/radio/99-tmp.mp3'
        );
        // No session, so no Bearer — the minted URL carries its own token.
        expect(playback.headers?.['Authorization']).toBeUndefined();
    });

    it('guards a simple portal without requiring playback auth headers', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-2',
                portalUrl: 'https://simple.example.com/portal.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );
        stalkerSession.getCachedToken.mockReturnValue(null);

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-2::99',
            name: 'Simple Radio',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-2',
            playlistName: 'Stalker',
            stalkerId: '99',
            radio: 'true',
            stalkerCmd: 'https://simple.example.com/radio/99.mp3',
        } satisfies UnifiedCollectionItem);

        expect(stalkerSession.ensureToken).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'stalker-2',
                isFullStalkerPortal: false,
            })
        );
        expect(playback.headers?.['Authorization']).toBeUndefined();
    });

    it('keeps Stalker collection playback from a foreign CDN credential-free', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl:
                    'https://stalker.example.com/stalker_portal/server/load.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );
        stalkerSession.getCachedToken.mockReturnValue('TOKEN77');
        dataService.sendIpcEvent.mockResolvedValue({
            js: { cmd: 'ffmpeg http://cdn.other.example/live/88.ts' },
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::88',
            name: 'Direct Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '88',
            stalkerCmd: 'ffrt3 http://stalker.example.com/media/88.mpg',
        } satisfies UnifiedCollectionItem);

        expect(playback.headers?.['Cookie']).toBeUndefined();
        expect(playback.headers?.['Authorization']).toBeUndefined();
        expect(playback.headers?.['User-Agent']).toBe('KSPlayer');
        expect(playback.referer).toBeUndefined();
        expect(playback.origin).toBeUndefined();
    });

    it('plays an unflagged Stalker favorite from its stored cmd without create_link', async () => {
        // Favorites persist the raw catalog row, so `use_http_tmp_link` /
        // `use_load_balancing` come back with it — a row that sets neither is
        // playable as it stands and must not cost a portal round trip.
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com/portal.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::90',
            name: 'Static Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '90',
            stalkerCmd: 'ffrt3 http://cdn.example.com/live/90.m3u8',
            stalkerItem: {
                id: '90',
                cmd: 'ffrt3 http://cdn.example.com/live/90.m3u8',
                use_http_tmp_link: '0',
                use_load_balancing: '0',
            },
        } as UnifiedCollectionItem);

        // The detail route still loads EPG; what must not happen is a link
        // request.
        const requestedActions = [
            ...dataService.sendIpcEvent.mock.calls,
            ...stalkerSession.makeAuthenticatedRequest.mock.calls,
        ].map(
            (call) =>
                (call[1] as { params?: { action?: string } } | undefined)
                    ?.params?.action
        );
        expect(requestedActions).not.toContain('create_link');
        expect(playback.streamUrl).toBe('http://cdn.example.com/live/90.m3u8');
        expect(playback.isLive).toBe(true);
    });

    it('authenticates a cold full-portal session before a static stream', async () => {
        // Skipping create_link also skips the request that used to warm the
        // session. Tokens are in-memory only, so a cold start from global
        // Favorites would otherwise hand a same-host gated stream headers
        // with no Authorization and take a 403.
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl:
                    'https://stalker.example.com/stalker_portal/server/load.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: true,
            } satisfies Partial<Playlist>)
        );
        // Cold: no token until ensureToken has run.
        stalkerSession.getCachedToken.mockReturnValue(null);
        stalkerSession.ensureToken.mockImplementation(async () => {
            stalkerSession.getCachedToken.mockReturnValue('TOKEN-COLD');
            return { token: 'TOKEN-COLD' };
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::91',
            name: 'Cold Static Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '91',
            stalkerCmd: 'ffrt3 https://stalker.example.com/live/91.m3u8',
            stalkerItem: {
                id: '91',
                cmd: 'ffrt3 https://stalker.example.com/live/91.m3u8',
                use_http_tmp_link: '0',
            },
        } as UnifiedCollectionItem);

        expect(stalkerSession.ensureToken).toHaveBeenCalledWith(
            expect.objectContaining({ _id: 'stalker-1' })
        );
        expect(playback.streamUrl).toBe(
            'https://stalker.example.com/live/91.m3u8'
        );
        expect(playback.headers?.['Authorization']).toBe('Bearer TOKEN-COLD');
    });

    it('serves a foreign-host static stream without waiting on the portal', async () => {
        // The CDN needs no portal credentials, so the handshake would be a
        // discarded result — and a stall of up to 15 s when the portal is
        // slow or offline but the CDN is fine.
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl:
                    'https://stalker.example.com/stalker_portal/server/load.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: true,
            } satisfies Partial<Playlist>)
        );

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::94',
            name: 'Cdn Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '94',
            stalkerCmd: 'ffrt3 https://cdn.example.com/live/94.m3u8',
            stalkerItem: {
                id: '94',
                cmd: 'ffrt3 https://cdn.example.com/live/94.m3u8',
                use_http_tmp_link: '0',
            },
        } as UnifiedCollectionItem);

        expect(playback.streamUrl).toBe('https://cdn.example.com/live/94.m3u8');
        expect(stalkerSession.ensureToken).not.toHaveBeenCalled();
    });

    it('falls back to create_link when the handshake throws', async () => {
        // A throwing handshake must not propagate. It leaves the session
        // unusable, so a PORTAL-OWNED url goes to `create_link` rather than
        // being served as a known 401 — the url has to be portal-owned for
        // the handshake to run at all now that classification comes first.
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl:
                    'https://stalker.example.com/stalker_portal/server/load.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: true,
            } satisfies Partial<Playlist>)
        );
        stalkerSession.ensureToken.mockRejectedValue(new Error('portal down'));
        stalkerSession.makeAuthenticatedRequest.mockResolvedValue({
            js: { cmd: 'https://stalker.example.com/tmp/92.ts?tok=1' },
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::92',
            name: 'Portal Static Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '92',
            stalkerCmd: 'ffrt3 https://stalker.example.com/live/92.m3u8',
            stalkerItem: {
                id: '92',
                cmd: 'ffrt3 https://stalker.example.com/live/92.m3u8',
                use_http_tmp_link: '0',
            },
        } as UnifiedCollectionItem);

        expect(stalkerSession.ensureToken).toHaveBeenCalled();
        expect(playback.streamUrl).toBe(
            'https://stalker.example.com/tmp/92.ts?tok=1'
        );
    });

    it('prefers the edited playlist coordinates over a stale favorite snapshot', async () => {
        // A favorite persists the portal URL and MAC it was saved with. After
        // the playlist is edited, the session token is negotiated for the NEW
        // identity — sending it with the old MAC cookie (or to the old host)
        // is the mismatch the identity fingerprint exists to prevent.
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl: 'https://new.example.com/portal.php',
                macAddress: 'AA:BB:CC:00:00:99',
                isFullStalkerPortal: true,
            } satisfies Partial<Playlist>)
        );
        // A full portal, so the Bearer assertion below is meaningful: only a
        // portal with a session has a token to attach at all.
        stalkerSession.ensureToken.mockResolvedValue({ token: 'TOKEN-NEW' });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::93',
            name: 'Edited Portal Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '93',
            stalkerCmd: 'ffrt3 https://new.example.com/live/93.m3u8',
            // Stale snapshot from before the edit.
            stalkerPortalUrl: 'https://old.example.com/portal.php',
            stalkerMacAddress: '00:11:22:33:44:55',
            stalkerItem: {
                id: '93',
                cmd: 'ffrt3 https://new.example.com/live/93.m3u8',
                use_http_tmp_link: '0',
            },
        } as UnifiedCollectionItem);

        expect(playback.headers?.['Cookie']).toContain('mac=AA:BB:CC:00:00:99');
        expect(playback.headers?.['Cookie']).not.toContain(
            'mac=00:11:22:33:44:55'
        );
        // Same host as the edited row ⇒ portal-owned ⇒ credentials attached.
        expect(playback.headers?.['Authorization']).toBe('Bearer TOKEN-NEW');
        expect(playback.origin).toBe('https://new.example.com');
    });

    it('mints a link for a flagged Stalker favorite', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com/portal.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );
        dataService.sendIpcEvent.mockResolvedValue({
            js: { cmd: 'ffmpeg http://cdn.example.com/tmp/90.m3u8?tok=1' },
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::90',
            name: 'Balanced Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '90',
            stalkerCmd: 'ffrt3 http://cdn.example.com/live/90.m3u8',
            stalkerItem: {
                id: '90',
                cmd: 'ffrt3 http://cdn.example.com/live/90.m3u8',
                use_load_balancing: '1',
            },
        } as UnifiedCollectionItem);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                params: expect.objectContaining({ action: 'create_link' }),
            })
        );
        expect(playback.streamUrl).toBe(
            'http://cdn.example.com/tmp/90.m3u8?tok=1'
        );
    });

    it('appends query-only Stalker create_link responses to the original cmd URL', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com/portal.php',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );
        dataService.sendIpcEvent.mockResolvedValue({
            js: { cmd: '?token=xyz' },
        });

        const playback = await service.resolvePlayback({
            uid: 'stalker::stalker-1::89',
            name: 'Token Channel',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker',
            stalkerId: '89',
            stalkerCmd: 'auto http://cdn.example.com/live/89.m3u8',
        } satisfies UnifiedCollectionItem);

        expect(playback.streamUrl).toBe(
            'http://cdn.example.com/live/89.m3u8?token=xyz'
        );
    });
});
