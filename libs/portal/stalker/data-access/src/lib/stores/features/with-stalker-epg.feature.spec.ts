import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import {
    DataService,
    EpgSourceSettingsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { EpgItem, Playlist } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { withStalkerEpg } from './with-stalker-epg.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const PLAYLIST = {
    _id: 'playlist-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-04-11T00:00:00.000Z',
    lastUsage: '2026-04-11T00:00:00.000Z',
    portalUrl: 'http://demo.example/portal.php',
    macAddress: '00:1A:79:00:00:01',
} as Playlist;

const TestStalkerEpgStore = signalStore(
    withState({
        currentPlaylist: PLAYLIST,
        selectedItvId: '10001',
    }),
    withStalkerEpg()
);

describe('withStalkerEpg', () => {
    let store: InstanceType<typeof TestStalkerEpgStore>;
    let dataService: {
        sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>;
    };
    let runtimeSupportsEpg: boolean;
    let stalkerSessionService: {
        makeAuthenticatedRequest: jest.Mock<Promise<unknown>, unknown[]>;
        ensureToken: jest.Mock<Promise<unknown>, unknown[]>;
    };
    let epgBridge: {
        supportsEpgMapping: boolean;
        getEpgMappingsBatch: jest.Mock<Promise<unknown>, unknown[]>;
        getChannelPrograms: jest.Mock<Promise<unknown>, unknown[]>;
    };

    beforeEach(() => {
        runtimeSupportsEpg = true;
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        stalkerSessionService = {
            makeAuthenticatedRequest: jest.fn(),
            ensureToken: jest.fn().mockResolvedValue({ token: null }),
        };
        epgBridge = {
            supportsEpgMapping: true,
            getEpgMappingsBatch: jest.fn().mockResolvedValue(null),
            getChannelPrograms: jest.fn().mockResolvedValue(null),
        };

        TestBed.configureTestingModule({
            providers: [
                TestStalkerEpgStore,
                { provide: DataService, useValue: dataService },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return runtimeSupportsEpg;
                        },
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: stalkerSessionService,
                },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
            ],
        });

        store = TestBed.inject(TestStalkerEpgStore);
    });

    it('fetches fallback short EPG via get_short_epg', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                data: [
                    buildEntry('10001', 'Current Show', 1744365600, 1744367400),
                ],
            },
        });

        const result = await store.fetchChannelEpg('10001');

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                url: PLAYLIST.portalUrl,
                macAddress: PLAYLIST.macAddress,
                params: expect.objectContaining({
                    action: 'get_short_epg',
                    type: 'itv',
                    ch_id: '10001',
                    size: '10',
                }),
            })
        );
        expect(result).toEqual([
            buildEpgItem('10001', 'Current Show', 1744365600, 1744367400),
        ]);
    });

    it('does not request short EPG in browser/PWA mode', async () => {
        runtimeSupportsEpg = false;

        const result = await store.fetchChannelEpg('10001');

        expect(result).toEqual([]);
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(
            stalkerSessionService.makeAuthenticatedRequest
        ).not.toHaveBeenCalled();
    });

    it('loads bulk EPG once and projects selected-channel programs from the cache', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                data: {
                    '10001': [
                        buildEntry(
                            '10001',
                            'Morning Show',
                            1744358400,
                            1744362000
                        ),
                        buildEntry(
                            '10001',
                            'Current Show',
                            1744362000,
                            1744365600
                        ),
                    ],
                    '10002': [
                        buildEntry(
                            '10002',
                            'Other Channel',
                            1744362000,
                            1744365600
                        ),
                    ],
                },
            },
        });

        await store.ensureBulkItvEpg(168);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: 'get_epg_info',
                    type: 'itv',
                    period: '168',
                }),
            })
        );
        expect(store.bulkItvEpgLoaded()).toBe(true);
        expect(store.bulkItvEpgPlaylistId()).toBe('playlist-1');
        expect(store.bulkItvEpgPeriodHours()).toBe(168);
        expect(store.selectedItvEpgPrograms()).toEqual([
            buildProgram('10001', 'Morning Show', 1744358400, 1744362000),
            buildProgram('10001', 'Current Show', 1744362000, 1744365600),
        ]);
    });

    it('treats bulk EPG failures as loaded-empty cache so callers can fallback to short EPG', async () => {
        dataService.sendIpcEvent.mockRejectedValue(new Error('unsupported'));

        await store.ensureBulkItvEpg(168);

        expect(store.bulkItvEpgLoaded()).toBe(true);
        expect(store.bulkItvEpgByChannel()).toEqual({});
        expect(store.selectedItvEpgPrograms()).toEqual([]);
        expect(store.isLoadingBulkItvEpg()).toBe(false);
    });
    describe('applyMappedItvEpg', () => {
        const MAPPED_PROGRAM = {
            channel: 'mapped.channel.id',
            title: 'Mapped Show',
            desc: 'From uploaded XMLTV',
            start: '2026-07-11T10:00:00.000Z',
            stop: '2026-07-11T11:00:00.000Z',
        };

        it('overlays uploaded XMLTV programs for mapped channels', async () => {
            epgBridge.getEpgMappingsBatch.mockResolvedValue({
                'stalker:playlist-1:10001': 'mapped.channel.id',
            });
            epgBridge.getChannelPrograms.mockResolvedValue([MAPPED_PROGRAM]);

            await store.applyMappedItvEpg(['10001', '10002']);

            expect(epgBridge.getEpgMappingsBatch).toHaveBeenCalledTimes(1);
            expect(epgBridge.getEpgMappingsBatch).toHaveBeenCalledWith([
                'stalker:playlist-1:10001',
                'stalker:playlist-1:10002',
            ]);
            expect(store.bulkItvEpgByChannel()['10001']).toEqual([
                { ...MAPPED_PROGRAM, channel: '10001' },
            ]);
            expect(store.selectedItvEpgPrograms()).toEqual([
                { ...MAPPED_PROGRAM, channel: '10001' },
            ]);
        });

        it('checks each channel id only once per playlist session', async () => {
            epgBridge.getEpgMappingsBatch.mockResolvedValue({});

            await store.applyMappedItvEpg(['10001']);
            await store.applyMappedItvEpg(['10001']);

            expect(epgBridge.getEpgMappingsBatch).toHaveBeenCalledTimes(1);
        });

        it('drops removed-source overrides and reloads the selected mapping without a portal reset', async () => {
            epgBridge.getEpgMappingsBatch.mockResolvedValue({
                'stalker:playlist-1:10001': 'mapped.channel.id',
            });
            epgBridge.getChannelPrograms.mockResolvedValue([MAPPED_PROGRAM]);
            await store.applyMappedItvEpg(['10001']);
            epgBridge.getChannelPrograms.mockResolvedValue([]);
            const sources = TestBed.inject(EpgSourceSettingsService);
            sources.revision.update((value) => value + 1);
            sources.changed$.next();
            expect(store.selectedItvEpgPrograms()).toEqual([]);
            await store.applyMappedItvEpg(['10001']);
            expect(store.selectedItvEpgPrograms()).toEqual([]);
            // Saved mappings remain authoritative even when their source is gone.
            expect(store.hasItvEpgMappingOverride('10001')).toBe(true);
        });

        it('ignores a mapped-program response that completes after source invalidation', async () => {
            epgBridge.getEpgMappingsBatch.mockResolvedValue({
                'stalker:playlist-1:10001': 'mapped.channel.id',
            });
            let resolvePrograms!: (value: unknown) => void;
            epgBridge.getChannelPrograms.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolvePrograms = resolve;
                    })
            );
            const pending = store.applyMappedItvEpg(['10001']);
            await Promise.resolve();
            const sources = TestBed.inject(EpgSourceSettingsService);
            sources.revision.update((value) => value + 1);
            sources.changed$.next();
            resolvePrograms([MAPPED_PROGRAM]);
            await pending;
            expect(store.selectedItvEpgPrograms()).toEqual([]);
        });

        it('keeps overrides when ensureBulkItvEpg replaces the bulk record', async () => {
            epgBridge.getEpgMappingsBatch.mockResolvedValue({
                'stalker:playlist-1:10001': 'mapped.channel.id',
            });
            epgBridge.getChannelPrograms.mockResolvedValue([MAPPED_PROGRAM]);
            await store.applyMappedItvEpg(['10001']);

            dataService.sendIpcEvent.mockResolvedValue({
                js: {
                    '10002': [
                        {
                            name: 'Portal Show',
                            start_timestamp: 1_752_220_800,
                            stop_timestamp: 1_752_224_400,
                        },
                    ],
                },
            });
            await store.ensureBulkItvEpg(168);

            const record = store.bulkItvEpgByChannel();
            expect(record['10001']).toEqual([
                { ...MAPPED_PROGRAM, channel: '10001' },
            ]);
            expect(record['10002']?.length).toBeGreaterThan(0);
        });

        it('does not mark later IDs checked after a stale mapped lookup rejects', async () => {
            epgBridge.getEpgMappingsBatch.mockResolvedValue({
                'stalker:playlist-1:10001': 'mapped.channel.id',
            });
            let rejectPrograms!: (error: Error) => void;
            epgBridge.getChannelPrograms.mockImplementationOnce(
                () =>
                    new Promise((_, reject) => {
                        rejectPrograms = reject;
                    })
            );
            const pending = store.applyMappedItvEpg(['10001', '10002']);
            await Promise.resolve();
            store.clearBulkItvEpgCache();
            await store.applyMappedItvEpg(['10003']);
            rejectPrograms(new Error('old request failed'));
            await pending;
            epgBridge.getEpgMappingsBatch.mockResolvedValue({
                'stalker:playlist-1:10002': 'new.channel.id',
            });
            epgBridge.getChannelPrograms.mockResolvedValue([MAPPED_PROGRAM]);
            await store.applyMappedItvEpg(['10002']);
            expect(store.bulkItvEpgByChannel()['10002']).toEqual([
                { ...MAPPED_PROGRAM, channel: '10002' },
            ]);
        });

        it('allows initial bulk loading and mapping lookup to finish concurrently', async () => {
            let finishBulk!: (value: unknown) => void;
            const response = new Promise((resolve) => {
                finishBulk = resolve;
            });
            dataService.sendIpcEvent.mockReturnValueOnce(response);
            const bulk = store.ensureBulkItvEpg();
            epgBridge.getEpgMappingsBatch.mockResolvedValue({
                'stalker:playlist-1:10001': 'mapped.channel.id',
            });
            epgBridge.getChannelPrograms.mockResolvedValue([]);
            await store.applyMappedItvEpg(['10001']);
            finishBulk({
                js: {
                    '10001': [
                        buildEntry(
                            '10001',
                            'Portal Show',
                            1744365600,
                            1744367400
                        ),
                    ],
                },
            });
            await bulk;
            expect(store.isLoadingBulkItvEpg()).toBe(false);
            expect(store.bulkItvEpgLoaded()).toBe(true);
            expect(store.selectedItvEpgPrograms()).toEqual([]);
        });

        it('does nothing when the mapping bridge is unsupported', async () => {
            epgBridge.supportsEpgMapping = false;

            await store.applyMappedItvEpg(['10001']);

            expect(epgBridge.getEpgMappingsBatch).not.toHaveBeenCalled();
        });

        it('reports which channels carry a mapping override', async () => {
            epgBridge.getEpgMappingsBatch.mockResolvedValue({
                'stalker:playlist-1:10001': 'mapped.channel.id',
            });
            epgBridge.getChannelPrograms.mockResolvedValue([MAPPED_PROGRAM]);

            expect(store.hasItvEpgMappingOverride('10001')).toBe(false);

            await store.applyMappedItvEpg(['10001', '10002']);

            // Callers use this to keep mapped channels away from the portal
            // short-EPG fallback — the mapping replaces the portal schedule.
            expect(store.hasItvEpgMappingOverride('10001')).toBe(true);
            expect(store.hasItvEpgMappingOverride('10002')).toBe(false);
        });

        it('keeps ownership for a mapping whose mapped guide is currently empty', async () => {
            epgBridge.getEpgMappingsBatch.mockResolvedValue({
                'stalker:playlist-1:10001': 'mapped.channel.id',
            });
            epgBridge.getChannelPrograms.mockResolvedValue([]);
            const bulkBefore = store.bulkItvEpgByChannel();

            await store.applyMappedItvEpg(['10001']);

            // The mapping row exists, so the channel is owned even though it
            // contributes no programs — the portal fallback must stay out.
            expect(store.hasItvEpgMappingOverride('10001')).toBe(true);
            // Ownership is published reactively (same content, new map
            // reference): a short-EPG fallback that finished before the
            // mapping lookup may already have rendered a portal row, and the
            // preview effect only reruns — and removes it — on a state patch.
            expect(store.bulkItvEpgByChannel()).not.toBe(bulkBefore);
        });
    });
});

function buildEntry(
    channelId: string,
    title: string,
    startTimestamp: number,
    stopTimestamp: number
) {
    return {
        id: `${channelId}-${startTimestamp}`,
        ch_id: channelId,
        name: title,
        descr: `${title} description`,
        start: new Date(startTimestamp * 1000).toISOString(),
        stop: new Date(stopTimestamp * 1000).toISOString(),
        start_timestamp: startTimestamp,
        stop_timestamp: stopTimestamp,
    };
}

function buildEpgItem(
    channelId: string,
    title: string,
    startTimestamp: number,
    stopTimestamp: number
): EpgItem {
    return {
        id: `${channelId}-${startTimestamp}`,
        epg_id: '',
        title,
        description: `${title} description`,
        lang: '',
        start: new Date(startTimestamp * 1000).toISOString(),
        end: new Date(stopTimestamp * 1000).toISOString(),
        stop: new Date(stopTimestamp * 1000).toISOString(),
        channel_id: channelId,
        start_timestamp: String(startTimestamp),
        stop_timestamp: String(stopTimestamp),
    };
}

function buildProgram(
    channelId: string,
    title: string,
    startTimestamp: number,
    stopTimestamp: number
) {
    return {
        start: new Date(startTimestamp * 1000).toISOString(),
        stop: new Date(stopTimestamp * 1000).toISOString(),
        channel: channelId,
        title,
        desc: `${title} description`,
        category: null,
        startTimestamp,
        stopTimestamp,
    };
}
