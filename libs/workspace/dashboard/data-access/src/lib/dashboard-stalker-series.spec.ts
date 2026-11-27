import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    StalkerEpisodeResolver,
    StalkerFavoritePlaybackResolver,
    StalkerPortalRepairService,
    StalkerSessionService,
    type StalkerMappedEpisode,
} from '@iptvnator/portal/stalker/data-access';
import { XtreamApiService } from '@iptvnator/portal/xtream/data-access';
import {
    DataService,
    ParentalLockService,
    PlaylistsService,
} from '@iptvnator/services';
import type {
    PlaybackPositionData,
    PlaylistMeta,
    PortalRecentItem,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { createDashboardContinueWatching } from './dashboard-continue-watching';
import {
    loadDashboardPlaybackPositions,
    seriesPlaybackPositionMapKey,
    storedDashboardPlaybackPositionForItem,
} from './dashboard-playback-positions';
import {
    classifyDashboardSeries,
    dashboardRecentItemKey,
} from './dashboard-series-continuation.util';
import {
    ambiguousDashboardStalkerSeriesParents,
    createDashboardSeriesEpisodesRequest,
    dashboardSeriesEpisodesRequestKey,
    type DashboardSeriesEpisodesRequest,
} from './dashboard-series-episodes-request';
import {
    DASHBOARD_SERIES_EPISODES_MAX_AGE_MS,
    DashboardSeriesEpisodesService,
} from './dashboard-series-episodes.service';

const SOURCE: PlaylistMeta = {
    _id: 'synthetic-portal',
    title: 'Fixture portal',
    count: 0,
    importDate: '',
    autoRefresh: false,
    portalUrl: 'https://fixture.example.test/portal.php',
    macAddress: '02:00:00:00:00:01',
    isFullStalkerPortal: false,
};
const PARENT = 42;
const regularSeason = {
    id: 'regular-season',
    name: 'Season 1',
    cmd: '/media/fixture-regular',
    series: [1, 2],
};
const embedded = {
    id: PARENT,
    title: 'Fixture embedded series',
    cmd: '/media/fixture-embedded',
    series: [1, 2],
};
const lazy = { id: PARENT, is_series: 1, category_id: 'vod' };
const flush = () => new Promise((resolve) => setTimeout(resolve));

function recent(
    raw: StalkerPortalItem = { id: PARENT, category_id: 'series' },
    type: PortalRecentItem['type'] = 'series'
): PortalRecentItem {
    return {
        id: PARENT,
        xtream_id: PARENT,
        title: raw.title ?? 'Fixture series',
        category_id: raw.category_id ?? '7',
        type,
        watch_kind: 'series',
        source: 'stalker',
        playlist_id: SOURCE._id,
        viewed_at: '2026-10-04T10:00:00Z',
        stalker_item: raw,
    };
}

function request(
    item: PortalRecentItem,
    playlist = SOURCE
): DashboardSeriesEpisodesRequest {
    const request = createDashboardSeriesEpisodesRequest(
        item,
        playlist,
        PARENT
    );
    if (!request) throw new Error('Expected a series lookup');
    return request;
}

function position(
    episode: StalkerMappedEpisode,
    watched = true,
    lastPlayed = episode.episode_num
): PlaybackPositionData {
    return {
        contentXtreamId: Number(episode.id),
        contentType: 'episode',
        playlistId: SOURCE._id,
        seriesXtreamId: PARENT,
        seasonNumber: episode.season,
        episodeNumber: episode.episode_num,
        positionSeconds: watched ? 100 : 10,
        durationSeconds: 100,
        updatedAt: `2026-10-04T10:00:0${lastPlayed}Z`,
        activityIdentity: episode.activityIdentity,
    };
}

describe('Shared dashboard Stalker episode lookup', () => {
    let catalogs: DashboardSeriesEpisodesService;
    const sendIpcEvent = jest.fn();
    const metadata = jest.fn();
    const getPlaylistById = jest.fn();
    const makeAuthenticatedRequest = jest.fn();

    beforeEach(() => {
        sendIpcEvent.mockReset();
        metadata.mockReset();
        makeAuthenticatedRequest.mockReset();
        getPlaylistById
            .mockReset()
            .mockReturnValue(of({ ...SOURCE, lastUsage: '' }));
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: XtreamApiService,
                    useValue: { getSeriesInfo: jest.fn() },
                },
                { provide: DataService, useValue: { sendIpcEvent } },
                { provide: PlaylistsService, useValue: { getPlaylistById } },
                { provide: ParentalLockService, useValue: {} },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        ensureToken: jest.fn().mockResolvedValue({}),
                        makeAuthenticatedRequest,
                    },
                },
                {
                    provide: StalkerPortalRepairService,
                    useValue: {
                        applyOverride: (playlist: PlaylistMeta) => playlist,
                        shouldAttemptRepair: () => false,
                    },
                },
                { provide: StalkerEpisodeResolver, useValue: {} },
                {
                    provide: StalkerFavoritePlaybackResolver,
                    useValue: { metadata },
                },
            ],
        });
        catalogs = TestBed.inject(DashboardSeriesEpisodesService);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    const entries = (started: DashboardSeriesEpisodesRequest) => {
        const result = catalogs.get(started);
        if (result?.status !== 'loaded')
            throw new Error('Expected a loaded list');
        return Object.values(result.seasons).flat() as StalkerMappedEpisode[];
    };

    const resolve = (
        request: DashboardSeriesEpisodesRequest,
        newest: PlaybackPositionData,
        positions: readonly PlaybackPositionData[] = [newest]
    ) =>
        classifyDashboardSeries({
            request,
            newest,
            positions,
            episodes: catalogs.get(request),
        });

    it('resolves regular series without conflating caught up and fully watched', async () => {
        sendIpcEvent.mockResolvedValue({ js: [regularSeason] });
        const started = request(recent());
        catalogs.request([started]);
        await flush();

        expect(sendIpcEvent).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                params: {
                    action: 'get_ordered_list',
                    movie_id: String(PARENT),
                    type: 'series',
                    p: 1,
                },
            })
        );
        const [first, last] = entries(started).map((episode) =>
            position(episode)
        );
        expect(resolve(started, first)).toMatchObject({
            continuation: {
                kind: 'continue',
                position: {
                    contentXtreamId: last.contentXtreamId,
                    positionSeconds: 0,
                },
            },
            fullyWatched: false,
        });
        expect(resolve(started, last)).toEqual({
            continuation: { kind: 'finished' },
            fullyWatched: false,
        });
        expect(resolve(started, last, [first, last])).toEqual({
            continuation: { kind: 'finished' },
            fullyWatched: true,
        });
    });

    it('loads authoritative embedded metadata before using a stale recent snapshot', async () => {
        const started = request(recent(embedded, 'movie'));
        let now = Date.now();
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        metadata.mockResolvedValue({ ...embedded, series: [1, 2, 3] });
        catalogs.request([started], 1);
        await flush();

        const initial = entries(started).map((episode) => position(episode));
        expect(resolve(started, initial[1], initial.slice(0, 2))).toMatchObject(
            {
                continuation: {
                    kind: 'continue',
                    position: { episodeNumber: 3, positionSeconds: 0 },
                },
                fullyWatched: false,
            }
        );
        expect(resolve(started, initial[2], initial).fullyWatched).toBe(true);

        metadata.mockResolvedValue({ ...embedded, series: [1, 2, 3, 4] });
        now += DASHBOARD_SERIES_EPISODES_MAX_AGE_MS;
        catalogs.request([started], 2);
        await flush();
        expect(resolve(started, initial[2], initial)).toMatchObject({
            continuation: { kind: 'continue', position: { episodeNumber: 4 } },
            fullyWatched: false,
        });
    });

    it('reconciles old Ministra ids before deciding that an episode list is stale', async () => {
        sendIpcEvent.mockImplementation((_event, { params }) =>
            params.season_id
                ? Promise.resolve({
                      js: [
                          {
                              id: 'provider-episode-1',
                              series_number: 1,
                              is_episode: true,
                          },
                          {
                              id: 'provider-episode-2',
                              series_number: 2,
                              is_episode: true,
                          },
                      ],
                  })
                : Promise.resolve({
                      js: [
                          {
                              id: 'provider-season-1',
                              video_id: 'provider-file-1',
                              season_number: '1',
                              is_season: true,
                          },
                      ],
                  })
        );
        const started = request(recent(lazy));
        catalogs.request([started]);
        await flush();

        const [first, last] = entries(started);
        if (first.legacyTrackingId === undefined) {
            throw new Error('Expected a Ministra legacy tracking id');
        }
        const legacy = {
            ...position(first),
            contentXtreamId: first.legacyTrackingId,
        };
        expect(resolve(started, legacy)).toMatchObject({
            continuation: {
                kind: 'continue',
                position: { contentXtreamId: Number(last.id) },
            },
            fullyWatched: false,
        });
        expect(resolve(started, { ...legacy, episodeNumber: 9 })).toEqual({
            continuation: { kind: 'unknown', stale: true },
            fullyWatched: false,
        });
        const newest = position(last);
        expect(resolve(started, newest, [legacy, newest]).fullyWatched).toBe(
            true
        );
    });

    it('invalidates cached Stalker status when a refresh returns a partial list', async () => {
        let now = Date.now();
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        sendIpcEvent.mockResolvedValueOnce({ js: [regularSeason] });
        sendIpcEvent.mockImplementation((_event, { params }) =>
            Promise.resolve({
                js: {
                    data: params.p === 1 ? [regularSeason] : [],
                    total_items: 2,
                },
            })
        );
        const started = request(recent());
        catalogs.request([started], 1);
        await flush();
        expect(entries(started)).toHaveLength(2);
        now += DASHBOARD_SERIES_EPISODES_MAX_AGE_MS;
        catalogs.request([started], 2);
        await flush();

        expect(catalogs.get(started)).toEqual({ status: 'failed' });
        expect(
            resolve(started, {
                contentType: 'episode',
                contentXtreamId: 77,
                seriesXtreamId: PARENT,
                positionSeconds: 100,
                durationSeconds: 100,
            })
        ).toEqual({ continuation: { kind: 'unknown' }, fullyWatched: false });
    });

    it('keeps concurrent regular and embedded lookups and playback rows separate when their parent ids overlap', async () => {
        const regularItem = recent();
        const embeddedItem = recent(embedded, 'movie');
        const regular = request(regularItem);
        const vod = request(embeddedItem);
        expect(dashboardSeriesEpisodesRequestKey(regular)).not.toEqual(
            dashboardSeriesEpisodesRequestKey(vod)
        );
        expect(dashboardRecentItemKey(recent(lazy))).not.toEqual(
            dashboardRecentItemKey(regularItem)
        );

        sendIpcEvent.mockResolvedValue({ js: [regularSeason] });
        metadata.mockResolvedValue(embedded);
        catalogs.request([regular, vod]);
        await flush();

        const watched = position(entries(regular)[1], true, 1);
        const unfinished = position(entries(vod)[1], false, 2);
        const maps = await loadDashboardPlaybackPositions(
            { getAllPlaybackPositions: async () => [watched, unfinished] },
            [SOURCE._id]
        );
        expect(storedDashboardPlaybackPositionForItem(maps, regularItem)).toBe(
            watched
        );
        expect(storedDashboardPlaybackPositionForItem(maps, embeddedItem)).toBe(
            unfinished
        );

        // Electron's SQLite projection may only return numeric playback IDs.
        const parentKey = seriesPlaybackPositionMapKey(SOURCE._id, PARENT);
        expect(
            ambiguousDashboardStalkerSeriesParents([
                regularItem,
                embeddedItem,
            ]).has(parentKey)
        ).toBe(true);
        const legacyRows = entries(regular).map((episode) => ({
            ...position(episode),
            activityIdentity: undefined,
        }));
        const otherCatalog = {
            ...unfinished,
            updatedAt: '2026-10-04T10:00:09Z',
            activityIdentity: undefined,
        };
        const input = {
            request: regular,
            newest: otherCatalog,
            positions: [...legacyRows, otherCatalog],
            episodes: catalogs.get(regular),
        };
        expect(classifyDashboardSeries(input)).toEqual({
            continuation: { kind: 'unknown', stale: true },
            fullyWatched: false,
        });
        expect(
            classifyDashboardSeries({ ...input, allowUnmappedLatest: true })
        ).toEqual({
            continuation: { kind: 'finished' },
            fullyWatched: true,
        });
        const sameCatalog = {
            ...otherCatalog,
            activityIdentity: watched.activityIdentity,
        };
        expect(
            classifyDashboardSeries({
                ...input,
                newest: sameCatalog,
                positions: [...legacyRows, sameCatalog],
                allowUnmappedLatest: true,
            })
        ).toEqual({
            continuation: { kind: 'unknown', stale: true },
            fullyWatched: false,
        });

        const sqlite = await loadDashboardPlaybackPositions(
            { getAllPlaybackPositions: async () => input.positions },
            [SOURCE._id]
        );
        const rail = TestBed.runInInjectionContext(() =>
            createDashboardContinueWatching({
                items: signal([regularItem, embeddedItem]),
                historyLoaded: signal(true),
                playlists: signal([SOURCE]),
                storedPosition: (item) =>
                    storedDashboardPlaybackPositionForItem(sqlite, item),
                episodeRows: (playlistId, parentId) =>
                    sqlite.episodesBySeries.get(
                        seriesPlaybackPositionMapKey(playlistId, parentId)
                    ),
                positionsLoadedFor: signal(new Set([SOURCE._id])),
                positionReloads: signal(1),
            })
        );
        expect(rail.items()).toEqual([embeddedItem]);
    });

    it('hydrates one full Electron source for a batch before authenticated catalog requests', async () => {
        const full = {
            ...SOURCE,
            isFullStalkerPortal: true,
            stalkerDeviceId1: 'fixture-device',
            stalkerSignature1: 'fixture-signature',
            lastUsage: '',
        };
        getPlaylistById.mockReturnValue(of(full));
        makeAuthenticatedRequest.mockResolvedValue({ js: [regularSeason] });
        metadata.mockResolvedValue(embedded);
        const thin = { ...SOURCE, isFullStalkerPortal: undefined };
        const requests = [
            request(recent(), thin),
            request(recent(embedded, 'movie'), thin),
        ];
        catalogs.request(requests);
        await flush();

        for (const lookup of requests) expect(entries(lookup)).toHaveLength(2);
        expect(getPlaylistById).toHaveBeenCalledTimes(1);
        expect(makeAuthenticatedRequest).toHaveBeenCalledWith(
            full,
            expect.anything(),
            true,
            { silent: true }
        );
    });

    it('does not dispatch if the stored source moved since the inventory snapshot', async () => {
        getPlaylistById.mockReturnValue(
            of({
                ...SOURCE,
                lastUsage: '',
                portalUrl: 'https://moved.example.test/portal.php',
            })
        );
        const started = request(recent());
        catalogs.request([started]);
        await flush();

        expect(catalogs.get(started)).toEqual({ status: 'failed' });
        expect(sendIpcEvent).not.toHaveBeenCalled();
        expect(makeAuthenticatedRequest).not.toHaveBeenCalled();
    });

    it('leaves a lazy Stalker series unknown when an advertised main season is empty', async () => {
        sendIpcEvent.mockImplementation((_event, { params }) =>
            Promise.resolve({
                js: params.season_id
                    ? params.season_id === 'season-1'
                        ? [
                              {
                                  id: 'fixture-episode-1',
                                  series_number: 1,
                                  is_episode: true,
                              },
                          ]
                        : []
                    : [
                          {
                              id: 'season-1',
                              video_id: 'file-1',
                              season_number: '1',
                              is_season: true,
                          },
                          {
                              id: 'season-2',
                              video_id: 'file-2',
                              season_number: '2',
                              is_season: true,
                          },
                      ],
            })
        );
        const started = request(recent(lazy));
        catalogs.request([started]);
        await flush();

        expect(catalogs.get(started)).toEqual({ status: 'failed' });
    });

    it('discards an old catalog response even if the source settings change back while it is in flight', async () => {
        let resolveOld!: (value: unknown) => void;
        sendIpcEvent.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveOld = resolve;
            })
        );
        sendIpcEvent.mockResolvedValue({
            js: [{ ...regularSeason, series: [1, 2, 3] }],
        });

        const initial = request(recent());
        const moved = request(recent(), {
            ...SOURCE,
            macAddress: '02:00:00:00:00:02',
        });
        catalogs.request([initial], 1);
        await flush();
        expect(catalogs.get(moved)).toBeUndefined();
        catalogs.request([moved], 1);
        catalogs.request([initial], 2);
        resolveOld({ js: [regularSeason] });
        await flush();

        expect(catalogs.get(moved)).toBeUndefined();
        expect(entries(initial).map((episode) => episode.episode_num)).toEqual([
            1, 2, 3,
        ]);
    });
});
