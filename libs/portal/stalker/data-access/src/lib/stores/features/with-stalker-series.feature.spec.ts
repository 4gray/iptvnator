import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { DataService, TmdbEnrichmentService } from '@iptvnator/services';
import {
    PlaylistMeta,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { withStalkerSelection } from './with-stalker-selection.feature';
import { withStalkerSeries } from './with-stalker-series.feature';

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
    importDate: '2026-04-14T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    isFullStalkerPortal: false,
} as PlaylistMeta;

const TestSeriesStore = signalStore(
    withState({
        currentPlaylist: undefined as PlaylistMeta | undefined,
    }),
    withMethods((store) => ({
        setCurrentPlaylist(playlist: PlaylistMeta | undefined) {
            patchState(store, { currentPlaylist: playlist });
        },
    })),
    withStalkerSelection(),
    withStalkerSeries()
);

async function flushResources(): Promise<void> {
    TestBed.flushEffects();
    await Promise.resolve();
    await Promise.resolve();
    TestBed.flushEffects();
    await Promise.resolve();
}

async function waitForCondition(
    predicate: () => boolean,
    attempts = 20
): Promise<void> {
    for (let index = 0; index < attempts; index += 1) {
        if (predicate()) {
            return;
        }

        await flushResources();
    }

    throw new Error('Timed out waiting for resource activity');
}

function seriesRequestCalls(
    sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>
) {
    return sendIpcEvent.mock.calls.filter(
        ([, payload]) =>
            (payload as { params?: { type?: string } })?.params?.type ===
            'series'
    );
}

describe('withStalkerSeries serialSeasonsResource gating', () => {
    let store: InstanceType<typeof TestSeriesStore>;
    let dataService: {
        sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>;
    };

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn().mockResolvedValue({ js: [] }),
        };

        TestBed.configureTestingModule({
            providers: [
                TestSeriesStore,
                { provide: DataService, useValue: dataService },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        makeAuthenticatedRequest: jest.fn(),
                        ensureToken: jest.fn().mockResolvedValue({
                            token: null,
                        }),
                    },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => false,
                    },
                },
            ],
        });

        store = TestBed.inject(TestSeriesStore);
        store.setCurrentPlaylist(PLAYLIST);
        void store.isSerialSeasonsLoading();
        void store.isVodSeriesSeasonsLoading();
    });

    it('keeps VOD seasons loaded when TMDB patches the selected item metadata', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                data: [
                    {
                        id: 's1',
                        video_id: '11',
                        is_season: true,
                        season_number: '1',
                    },
                ],
            },
        });
        store.setSelectedContentType('vod');
        store.setSelectedItem({ id: '11', name: 'Show s02', is_series: '1' });
        await waitForCondition(
            () => store.getVodSeriesSeasonsResource()?.length === 1
        );
        const originalSeasons = store.getVodSeriesSeasonsResource();
        const item = store.selectedItem();
        if (!item) throw new Error('Expected the selected VOD series');
        patchState(store, {
            selectedItem: { ...item, info: { ...item.info, tmdb_id: 777 } },
        });
        await flushResources();
        await flushResources();
        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(1);
        expect(store.getVodSeriesSeasonsResource()).toBe(originalSeasons);
        store.setSelectedItem({ id: '12', name: 'Show s03', is_series: '1' });
        await waitForCondition(
            () => dataService.sendIpcEvent.mock.calls.length === 2
        );
        expect(dataService.sendIpcEvent.mock.calls[1][1]).toMatchObject({
            params: { movie_id: '12' },
        });
    });

    it('fetches seasons for a regular series selection', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            js: [{ id: '42:1', name: 'Season 1', series: [1, 2] }],
        });

        store.setSelectedContentType('series');
        store.setSelectedItem({ id: '42', name: 'Regular series' });

        await waitForCondition(
            () => seriesRequestCalls(dataService.sendIpcEvent).length > 0
        );

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                url: PLAYLIST.portalUrl,
                macAddress: PLAYLIST.macAddress,
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'series',
                    movie_id: '42',
                }),
            })
        );
    });

    it('does not fire a series request for a plain VOD selection', async () => {
        store.setSelectedContentType('vod');
        store.setSelectedItem({ id: '7', name: 'Plain movie' });

        await flushResources();
        await flushResources();

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('does not fire a series request for an item with embedded series episodes', async () => {
        // vclub items carry their episodes inline and are always opened
        // under the VOD content type, where the seasons API is not the
        // episode source.
        store.setSelectedContentType('vod');
        store.setSelectedItem({
            id: '9',
            name: 'Embedded series',
            series: [1, 2, 3],
        });

        await flushResources();
        await flushResources();

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('still fetches seasons for a series selection carrying is_series', async () => {
        // Regression guard: under the `series` content type the detail view
        // renders <app-stalker-series-view /> without a vodWithSeries input,
        // so serialSeasonsResource is the only episode source. Gating the
        // fetch on item shape would render an empty episode list.
        store.setSelectedContentType('series');
        store.setSelectedItem({
            id: '42',
            name: 'Series flagged is_series',
            is_series: '1',
        });

        await waitForCondition(
            () => seriesRequestCalls(dataService.sendIpcEvent).length > 0
        );

        expect(
            seriesRequestCalls(dataService.sendIpcEvent)[0][1]
        ).toMatchObject({
            params: expect.objectContaining({
                type: 'series',
                movie_id: '42',
            }),
        });
    });

    it.each([true, 1, '1'] as const)(
        'does not fire a series request for a Ministra VOD-series item with is_series=%p',
        async (isSeries) => {
            store.setSelectedContentType('vod');
            store.setSelectedItem({
                id: '11',
                name: 'VOD series',
                is_series: isSeries,
            });

            // The legit vod-series season request (type=vod) may fire; the
            // wasted regular-series request (type=series) must not.
            await waitForCondition(
                () => dataService.sendIpcEvent.mock.calls.length > 0
            );
            await flushResources();

            expect(seriesRequestCalls(dataService.sendIpcEvent)).toHaveLength(
                0
            );
        }
    );

    it('does not fetch VOD-series seasons for unsupported truthy is_series', async () => {
        store.setSelectedContentType('vod');
        store.setSelectedItem({
            id: '11',
            name: 'Plain VOD',
            is_series: 'true',
        });

        await flushResources();
        await flushResources();

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('does not refetch seasons when a VOD item is selected after a series', async () => {
        store.setSelectedContentType('series');
        store.setSelectedItem({ id: '42', name: 'Regular series' });

        await waitForCondition(
            () => seriesRequestCalls(dataService.sendIpcEvent).length === 1
        );

        store.setSelectedContentType('vod');
        store.setSelectedItem({ id: '7', name: 'Plain movie' });

        await flushResources();
        await flushResources();

        expect(seriesRequestCalls(dataService.sendIpcEvent)).toHaveLength(1);
    });

    // Only a well-formed empty array is a trusted empty season: the series
    // watched toggle marks an answered-empty season as loaded, so a
    // malformed envelope collapsing to [] would silently skip that season.
    describe('fetchVodSeriesEpisodes strictness', () => {
        it('trusts a well-formed empty answer in either envelope shape', async () => {
            dataService.sendIpcEvent.mockResolvedValue({ js: { data: [] } });
            await expect(
                store.fetchVodSeriesEpisodes('11', 'season-2')
            ).resolves.toEqual([]);

            dataService.sendIpcEvent.mockResolvedValue({ js: [] });
            await expect(
                store.fetchVodSeriesEpisodes('11', 'season-2')
            ).resolves.toEqual([]);
        });

        it('rejects a malformed envelope instead of reporting an empty season', async () => {
            dataService.sendIpcEvent.mockResolvedValue({ js: {} });
            await expect(
                store.fetchVodSeriesEpisodes('11', 'season-2')
            ).rejects.toThrow('Malformed Stalker season episodes response');
        });

        it('rejects an answer whose rows contain no recognizable episode', async () => {
            dataService.sendIpcEvent.mockResolvedValue({
                js: { data: [{ id: 'junk-row', is_season: true }] },
            });
            await expect(
                store.fetchVodSeriesEpisodes('11', 'season-2')
            ).rejects.toThrow(
                'Stalker season answered without recognizable episodes'
            );
        });

        it('returns sorted episodes for a proper answer', async () => {
            dataService.sendIpcEvent.mockResolvedValue({
                js: {
                    data: [
                        { id: 'e2', is_episode: true, series_number: 2 },
                        { id: 'e1', is_episode: true, series_number: 1 },
                    ],
                },
            });
            await expect(
                store.fetchVodSeriesEpisodes('11', 'season-2')
            ).resolves.toEqual([
                { id: 'e1', is_episode: true, series_number: 1 },
                { id: 'e2', is_episode: true, series_number: 2 },
            ]);
        });
    });
});
