import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    DataService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { StreamResolverService } from './stream-resolver.service';

/**
 * Portal guides without the desktop XMLTV bridge (browser PWA, #1683):
 * Xtream and Stalker lookups depend on `supportsProviderEpg`, XMLTV lookups
 * on `supportsProgramLookup`. Kept apart from `stream-resolver.service.spec.ts`,
 * which sits at the test line cap.
 */
describe('StreamResolverService provider EPG', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const xtreamItem = {
        uid: 'xtream::xtream-1::1',
        name: 'Xtream Live',
        contentType: 'live',
        sourceType: 'xtream',
        playlistId: 'xtream-1',
        playlistName: 'Xtream',
        xtreamId: 1,
        tvgId: 'xtream.tv',
        logo: 'xtream.png',
    } satisfies UnifiedCollectionItem;
    // Rows carry the provider's XMLTV id at runtime, outside the interface.
    const xtreamXmltvItem = {
        ...xtreamItem,
        epgChannelId: 'xtream.xmltv',
    } as UnifiedCollectionItem;
    const stalkerItem = {
        uid: 'stalker::stalker-1::77',
        name: 'Stalker Channel',
        contentType: 'live',
        sourceType: 'stalker',
        playlistId: 'stalker-1',
        playlistName: 'Stalker',
        stalkerId: '77',
        tvgId: '77',
        stalkerCmd: 'ffmpeg http://stalker/77',
    } satisfies UnifiedCollectionItem;
    const m3uItem = {
        uid: 'm3u::m3u-1::news',
        name: 'M3U News',
        contentType: 'live',
        sourceType: 'm3u',
        playlistId: 'm3u-1',
        playlistName: 'M3U',
        tvgId: 'news.tv',
        streamUrl: 'https://m3u.example.com/news.m3u8',
    } satisfies UnifiedCollectionItem;
    const playlists: Record<string, Partial<Playlist>> = {
        'xtream-1': {
            _id: 'xtream-1',
            serverUrl: 'https://xtream.example.com',
            username: 'user',
            password: 'pass',
        },
        'stalker-1': {
            _id: 'stalker-1',
            portalUrl: 'https://stalker.example.com/portal.php',
            macAddress: '00:11:22:33:44:55',
            isFullStalkerPortal: false,
        },
    };
    const xtreamListing = (title: string) => ({
        id: '1',
        epg_id: '',
        title,
        description: `${title} description`,
        lang: '',
        start: new Date((nowSeconds - 60) * 1000).toISOString(),
        end: new Date((nowSeconds + 60) * 1000).toISOString(),
        stop: new Date((nowSeconds + 60) * 1000).toISOString(),
        channel_id: '1',
        start_timestamp: String(nowSeconds - 60),
        stop_timestamp: String(nowSeconds + 60),
    });
    const stalkerShortEpg = {
        js: [
            {
                id: '10',
                name: 'Stalker Now',
                descr: 'Current Stalker program',
                time: '2026-03-26T11:00:00.000Z',
                time_to: '2026-03-26T12:00:00.000Z',
                ch_id: '77',
                start_timestamp: String(nowSeconds - 60),
                stop_timestamp: String(nowSeconds + 60),
            },
        ],
    };

    let service: StreamResolverService;
    let runtime: { supportsProviderEpg: boolean };
    let epgBridge: {
        supportsProgramLookup: boolean;
        getChannelPrograms: jest.Mock;
        getEpgMapping: jest.Mock;
        getEpgMappingsBatch: jest.Mock;
    };
    let xtreamApi: { getShortEpg: jest.Mock; getFullEpg: jest.Mock };
    let dataService: { sendIpcEvent: jest.Mock };

    beforeEach(() => {
        runtime = { supportsProviderEpg: true };
        epgBridge = {
            supportsProgramLookup: false,
            getChannelPrograms: jest.fn().mockResolvedValue([]),
            getEpgMapping: jest.fn().mockResolvedValue(null),
            getEpgMappingsBatch: jest.fn().mockResolvedValue(null),
        };
        xtreamApi = {
            getShortEpg: jest
                .fn()
                .mockResolvedValue([xtreamListing('Xtream Now')]),
            getFullEpg: jest.fn().mockResolvedValue([]),
        };
        dataService = {
            sendIpcEvent: jest.fn(
                async (
                    _type: string,
                    request: { params: { action: string } }
                ) =>
                    request.params.action === 'create_link'
                        ? {
                              js: {
                                  cmd: 'ffmpeg http://cdn.example.com/tmp/77.m3u8',
                              },
                          }
                        : stalkerShortEpg
            ),
        };

        TestBed.configureTestingModule({
            providers: [
                StreamResolverService,
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: jest.fn((id: string) =>
                            of(playlists[id])
                        ),
                    },
                },
                { provide: XtreamApiService, useValue: xtreamApi },
                {
                    provide: XtreamUrlService,
                    useValue: {
                        constructLiveUrl: jest.fn(
                            () => 'https://xtream.example.com/live/1'
                        ),
                    },
                },
                { provide: DataService, useValue: dataService },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: () => 0 },
                },
                { provide: EpgRuntimeBridgeService, useValue: epgBridge },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        getCachedToken: jest.fn(() => null),
                        ensureToken: jest
                            .fn()
                            .mockResolvedValue({ token: null }),
                        makeAuthenticatedRequest: jest.fn(),
                    },
                },
            ],
        });

        service = TestBed.inject(StreamResolverService);
    });

    it.each(['xtream', 'stalker'] as const)(
        'resolves %s playback while the guide is still pending',
        async (source) => {
            jest.useFakeTimers();
            try {
                xtreamApi.getFullEpg.mockReturnValue(
                    new Promise(() => {
                        /* A provider that never answers. */
                    })
                );
                dataService.sendIpcEvent.mockImplementation(
                    async (
                        _type: string,
                        request: { params: { action: string } }
                    ) =>
                        request.params.action === 'create_link'
                            ? {
                                  js: {
                                      cmd: 'ffmpeg http://cdn.example.com/live.m3u8',
                                  },
                              }
                            : new Promise(() => {
                                  /* A provider that never answers. */
                              })
                );
                const resolved = jest.fn();
                void service
                    .resolvePlayback(
                        source === 'xtream' ? xtreamItem : stalkerItem
                    )
                    .then(resolved);
                for (let i = 0; i < 50; i++) await Promise.resolve();
                expect(resolved).toHaveBeenCalledWith(
                    expect.objectContaining({ isLive: true })
                );
                expect(xtreamApi.getFullEpg).not.toHaveBeenCalled();
                expect(
                    dataService.sendIpcEvent.mock.calls.every(
                        ([, payload]) => payload.params.action === 'create_link'
                    )
                ).toBe(true);
            } finally {
                jest.clearAllTimers();
                jest.useRealTimers();
            }
        }
    );

    it('keeps colliding provider IDs separate across playlists and source types', async () => {
        const secondXtream = {
            ...xtreamItem,
            playlistId: 'xtream-2',
            uid: 'other-xtream',
        };
        const secondStalker = {
            ...stalkerItem,
            playlistId: 'stalker-2',
            uid: 'other-stalker',
        };
        playlists['xtream-2'] = {
            ...playlists['xtream-1'],
            _id: 'xtream-2',
            serverUrl: 'https://second.example.com',
        };
        playlists['stalker-2'] = {
            ...playlists['stalker-1'],
            _id: 'stalker-2',
            portalUrl: 'https://second.example.com/portal.php',
        };
        xtreamApi.getShortEpg.mockImplementation(
            async (credentials: { serverUrl: string }) => [
                xtreamListing(credentials.serverUrl),
            ]
        );
        dataService.sendIpcEvent.mockImplementation(
            async (_type: string, request: { url: string }) => ({
                js: [{ ...stalkerShortEpg.js[0], name: request.url }],
            })
        );
        const items = [
            xtreamItem,
            secondXtream,
            stalkerItem,
            secondStalker,
        ].map((item) => ({ ...item, tvgId: 'shared.tv' }));

        const result = await service.loadEpgForItems(items);

        expect(result.size).toBe(4);
        expect(
            result.get(JSON.stringify(['xtream', 'xtream-1', '1']))?.title
        ).toBe('https://xtream.example.com');
        expect(
            result.get(JSON.stringify(['xtream', 'xtream-2', '1']))?.title
        ).toBe('https://second.example.com');
        expect(
            result.get(JSON.stringify(['stalker', 'stalker-1', '77']))?.title
        ).toBe('https://stalker.example.com/portal.php');
        expect(
            result.get(JSON.stringify(['stalker', 'stalker-2', '77']))?.title
        ).toBe('https://second.example.com/portal.php');
        expect(result.has('shared.tv')).toBe(false);
    });

    it('hydrates a Stalker guide without resolving playback a second time', async () => {
        const guide = await service.loadEpgItems(stalkerItem);
        expect(guide[0]?.title).toBe('Stalker Now');
        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(1);
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                silent: true,
                params: expect.objectContaining({ action: 'get_short_epg' }),
            })
        );
    });

    it('keeps collection Stalker EPG transport failures silent', async () => {
        dataService.sendIpcEvent.mockRejectedValue(
            new Error('EPG unsupported')
        );
        await service.loadEpgForItems([stalkerItem]);
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ silent: true })
        );
    });

    it('loads Xtream and Stalker rows from the portal without the XMLTV bridge', async () => {
        const epgMap = await service.loadEpgForItems([
            xtreamXmltvItem,
            stalkerItem,
            m3uItem,
        ]);

        expect(
            epgMap.get(JSON.stringify(['xtream', 'xtream-1', '1']))?.title
        ).toBe('Xtream Now');
        expect(
            epgMap.get(JSON.stringify(['stalker', 'stalker-1', '77']))?.title
        ).toBe('Stalker Now');
        // M3U rows need XMLTV, which this runtime does not have.
        expect(epgMap.has('news.tv')).toBe(false);
        expect(epgBridge.getChannelPrograms).not.toHaveBeenCalled();
        expect(epgBridge.getEpgMappingsBatch).not.toHaveBeenCalled();
    });

    it('resolves the Xtream detail guide from the portal without the XMLTV bridge', async () => {
        xtreamApi.getFullEpg.mockResolvedValue([
            xtreamListing('Full Guide Now'),
        ]);

        const detail = await service.resolveLiveDetail(xtreamXmltvItem);

        expect(detail.epgMode).toBe('portal');
        expect(detail.epgItems?.map((item) => item.title)).toEqual([
            'Full Guide Now',
        ]);
        expect(epgBridge.getChannelPrograms).not.toHaveBeenCalled();
        expect(epgBridge.getEpgMapping).not.toHaveBeenCalled();
    });

    it('resolves the Stalker detail guide from the portal without the XMLTV bridge', async () => {
        const detail = await service.resolveLiveDetail(stalkerItem);

        expect(detail.epgMode).toBe('portal');
        expect(detail.epgItems?.map((item) => item.title)).toEqual([
            'Stalker Now',
        ]);
        expect(epgBridge.getEpgMapping).not.toHaveBeenCalled();
    });

    it('loads M3U rows from XMLTV and asks no portal without a portal transport', async () => {
        runtime.supportsProviderEpg = false;
        epgBridge.supportsProgramLookup = true;
        epgBridge.getChannelPrograms.mockResolvedValue([
            {
                start: new Date((nowSeconds - 60) * 1000).toISOString(),
                stop: new Date((nowSeconds + 60) * 1000).toISOString(),
                channel: 'news.tv',
                title: 'M3U Now',
                desc: null,
                category: null,
            },
        ]);

        const epgMap = await service.loadEpgForItems([
            m3uItem,
            xtreamXmltvItem,
            stalkerItem,
        ]);

        expect(epgMap.get('news.tv')?.title).toBe('M3U Now');
        expect(epgMap.size).toBe(1);
        expect(epgBridge.getChannelPrograms).toHaveBeenCalledTimes(1);
        expect(epgBridge.getEpgMappingsBatch).not.toHaveBeenCalled();
        expect(xtreamApi.getShortEpg).not.toHaveBeenCalled();
        expect(xtreamApi.getFullEpg).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('asks no portal for EPG without a portal transport', async () => {
        runtime.supportsProviderEpg = false;
        epgBridge.supportsProgramLookup = true;

        const detail = await service.resolveLiveDetail(xtreamItem);
        const epgMap = await service.loadEpgForItems([xtreamItem, stalkerItem]);

        expect(detail.epgItems).toEqual([]);
        expect(epgMap.size).toBe(0);
        expect(xtreamApi.getShortEpg).not.toHaveBeenCalled();
        expect(xtreamApi.getFullEpg).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });
});
