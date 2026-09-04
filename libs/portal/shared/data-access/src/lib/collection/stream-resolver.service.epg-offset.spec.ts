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

    it('widens Stalker collection previews under a negative offset and picks the entry covering the provider clock', async () => {
        TestBed.inject(PlaylistsService).getPlaylistById = jest.fn(() =>
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );
        const nowSeconds = Math.floor(Date.now() / 1000);
        const entry = (id: string, name: string, startOffsetMin: number) => ({
            id,
            name,
            descr: '',
            time: '2026-03-26T11:00:00.000Z',
            time_to: '2026-03-26T12:00:00.000Z',
            ch_id: '77',
            start_timestamp: String(nowSeconds + startOffsetMin * 60),
            stop_timestamp: String(nowSeconds + (startOffsetMin + 30) * 60),
        });
        const sendIpcEvent = TestBed.inject(DataService)
            .sendIpcEvent as jest.Mock;
        sendIpcEvent.mockResolvedValue({
            js: [
                entry('10', 'Provider now', -10),
                entry('11', 'Soon', 20),
                entry('12', 'Really on air', 50),
            ],
        });
        // The guide runs an hour behind: the show really on air is the one
        // the portal files as starting in 50 minutes.
        epgOffsetMinutes = -60;

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

        expect(epgMap.get('77')?.title).toBe('Really on air');
        // 1 entry + ⌈60 / 15⌉ = 5 requested instead of the usual single one.
        expect(sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({ size: '5' }),
            })
        );
    });

    it('judges timestamp-less Stalker entries by their ISO boundaries', async () => {
        TestBed.inject(PlaylistsService).getPlaylistById = jest.fn(() =>
            of({
                _id: 'stalker-1',
                portalUrl: 'https://stalker.example.com',
                macAddress: '00:11:22:33:44:55',
                isFullStalkerPortal: false,
            } satisfies Partial<Playlist>)
        );
        const nowMs = Date.now();
        const entry = (id: string, name: string, startOffsetMin: number) => ({
            id,
            name,
            descr: '',
            time: new Date(nowMs + startOffsetMin * 60_000).toISOString(),
            time_to: new Date(
                nowMs + (startOffsetMin + 30) * 60_000
            ).toISOString(),
            ch_id: '77',
        });
        (
            TestBed.inject(DataService).sendIpcEvent as jest.Mock
        ).mockResolvedValue({
            js: [
                entry('10', 'Provider now', -10),
                entry('12', 'Really on air', 50),
            ],
        });
        epgOffsetMinutes = -60;

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

        // Without unix timestamps the ISO window still rules out the
        // portal's own "now" entry under the shifted clock.
        expect(epgMap.get('77')?.title).toBe('Really on air');
    });

    it('cuts the Xtream window at the instant the batch was evaluated, not when the guide arrives', async () => {
        jest.useFakeTimers();
        try {
            const startMs = Date.parse('2026-05-23T10:00:00.000Z');
            jest.setSystemTime(startMs);
            const nowSeconds = Math.floor(startMs / 1000);
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
            // +60: the provider clock at the start of the load is 09:00. "A"
            // covers it and ends at 09:35; the guide takes 40 minutes to
            // arrive, so a window cut at arrival time would already have
            // dropped "A" and the row would come back empty.
            xtreamApi.getFullEpg.mockImplementation(async () => {
                jest.setSystemTime(startMs + 40 * 60_000);
                return [listing('A', -90, 65), listing('B', -25, 30)];
            });
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

            expect(epgMap.get('Xtream Live')?.title).toBe('A');
        } finally {
            jest.useRealTimers();
        }
    });

    it('evaluates a whole collection load against the offset it started with', async () => {
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
        epgOffsetMinutes = 60;
        // The setting flips back to 0 while the batch is still resolving
        // credentials — before any guide request went out.
        TestBed.inject(PlaylistsService).getPlaylistById = jest.fn(() => {
            epgOffsetMinutes = 0;
            return of({
                _id: 'xtream-1',
                serverUrl: 'https://xtream.example.com',
                username: 'user',
                password: 'pass',
            } satisfies Partial<Playlist>);
        });
        xtreamApi.getFullEpg.mockResolvedValue([
            listing('Really on air', -75, 60),
            listing('Provider now', -15, 30),
        ]);
        xtreamApi.getShortEpg.mockResolvedValue([
            listing('Provider now', -15, 30),
        ]);

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

        // The load keeps the +60 snapshot it began with: it fetches the full
        // guide and picks the programme covering that provider clock, rather
        // than mixing a short-EPG window for offset 0 with a +60 selection.
        expect(xtreamApi.getShortEpg).not.toHaveBeenCalled();
        expect(epgMap.get('Xtream Live')?.title).toBe('Really on air');
    });
});
