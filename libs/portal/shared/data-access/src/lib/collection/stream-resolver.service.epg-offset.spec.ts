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
import { StreamResolverService } from './stream-resolver.service';

/**
 * EPG display-offset behaviour of the collection resolver. Kept apart from
 * `stream-resolver.service.spec.ts`, which sits at the test line cap.
 */
describe('StreamResolverService EPG display offset', () => {
    let service: StreamResolverService;
    let xtreamApi: { getShortEpg: jest.Mock; getFullEpg: jest.Mock };
    let epgOffsetMinutes = 0;

    beforeEach(() => {
        epgOffsetMinutes = 0;
        xtreamApi = { getShortEpg: jest.fn(), getFullEpg: jest.fn() };

        TestBed.configureTestingModule({
            providers: [
                StreamResolverService,
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: jest.fn(() =>
                            of({
                                _id: 'xtream-1',
                                serverUrl: 'https://xtream.example.com',
                                username: 'user',
                                password: 'pass',
                            } satisfies Partial<Playlist>)
                        ),
                    },
                },
                { provide: XtreamApiService, useValue: xtreamApi },
                {
                    provide: XtreamUrlService,
                    useValue: { constructLiveUrl: jest.fn() },
                },
                { provide: DataService, useValue: { sendIpcEvent: jest.fn() } },
                {
                    provide: SettingsStore,
                    useValue: {
                        resolvedEpgOffsetMinutes: () => epgOffsetMinutes,
                    },
                },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        getChannelPrograms: jest.fn(),
                        getEpgMapping: jest.fn().mockResolvedValue(null),
                        getEpgMappingsBatch: jest.fn().mockResolvedValue(null),
                        supportsProgramLookup: true,
                    },
                },
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
                {
                    provide: StalkerPortalRepairService,
                    useValue: { repair: jest.fn() },
                },
            ],
        });

        service = TestBed.inject(StreamResolverService);
    });

    it('cuts Xtream collection previews from the full guide at the provider clock', async () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const listing = (
            title: string,
            startOffsetMin: number,
            durationMin: number
        ) => {
            const start = nowSeconds + startOffsetMin * 60;
            const stop = start + durationMin * 60;
            return {
                id: title,
                epg_id: title,
                title,
                lang: 'en',
                description: '',
                channel_id: '1',
                start: new Date(start * 1000).toISOString(),
                end: new Date(stop * 1000).toISOString(),
                stop: new Date(stop * 1000).toISOString(),
                start_timestamp: String(start),
                stop_timestamp: String(stop),
            };
        };
        xtreamApi.getFullEpg.mockResolvedValue([
            listing('Provider now', -15, 30),
            listing('Really on air', -75, 60),
            listing('Long gone', -180, 60),
        ]);
        // The guide runs an hour ahead: the show really on air is the one
        // the provider files as finished 15 minutes ago, which get_short_epg
        // (starting at provider-now) never returns.
        epgOffsetMinutes = 60;

        const epgMap = await service.loadEpgForItems([
            {
                uid: 'xtream::xtream-1::1',
                name: 'Xtream Live',
                contentType: 'live',
                sourceType: 'xtream',
                playlistId: 'xtream-1',
                playlistName: 'Xtream',
                xtreamId: 1,
            } satisfies UnifiedCollectionItem,
        ]);

        expect(xtreamApi.getShortEpg).not.toHaveBeenCalled();
        expect(xtreamApi.getFullEpg).toHaveBeenCalledTimes(1);
        expect(epgMap.get('Xtream Live')?.title).toBe('Really on air');
    });
});
