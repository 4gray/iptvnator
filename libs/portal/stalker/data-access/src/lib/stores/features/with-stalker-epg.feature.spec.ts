import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import { DataService } from '@iptvnator/services';
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
    let stalkerSessionService: {
        makeAuthenticatedRequest: jest.Mock<Promise<unknown>, unknown[]>;
    };

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        stalkerSessionService = {
            makeAuthenticatedRequest: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                TestStalkerEpgStore,
                { provide: DataService, useValue: dataService },
                {
                    provide: StalkerSessionService,
                    useValue: stalkerSessionService,
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

    it('loads bulk EPG once and projects selected-channel programs from the cache', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                data: {
                    '10001': [
                        buildEntry('10001', 'Morning Show', 1744358400, 1744362000),
                        buildEntry('10001', 'Current Show', 1744362000, 1744365600),
                    ],
                    '10002': [
                        buildEntry('10002', 'Other Channel', 1744362000, 1744365600),
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
