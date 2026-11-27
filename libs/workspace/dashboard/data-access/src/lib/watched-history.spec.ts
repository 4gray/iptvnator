import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import {
    PORTAL_PLAYBACK_POSITIONS,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { announceActivityChange } from '@iptvnator/services/activity-changes';
import type {
    PlaybackPositionData,
    PlaylistMeta,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    DashboardSeriesEpisodesService,
    type DashboardSeriesEpisodes,
    type DashboardSeriesEpisodesRequest,
} from './dashboard-series-episodes.service';
import { createWatchedHistory } from './watched-history';

const day = '2026-01-01T00:00:00.000Z';
const playlist = (id: string): PlaylistMeta => ({
    _id: id,
    title: id,
    count: 1,
    importDate: day,
    autoRefresh: false,
    serverUrl: 'https://library.example',
    username: 'demo',
    password: 'demo',
});

function item(
    id: number,
    contentType: UnifiedCollectionItem['contentType'] = 'movie',
    playlistId = 'demo-a'
): UnifiedCollectionItem {
    return {
        uid: `${playlistId}:${contentType}:${id}`,
        name: `Title ${id}`,
        contentType,
        sourceType: 'xtream',
        playlistId,
        playlistName: playlistId,
        xtreamId: id,
        viewedAt: day,
    };
}

function position(
    id: number,
    percent: number,
    fields: Partial<PlaybackPositionData> = {}
): PlaybackPositionData {
    return {
        contentXtreamId: id,
        contentType: 'vod',
        positionSeconds: percent,
        durationSeconds: 100,
        ...fields,
    };
}

function episodePosition(
    seriesId: number,
    episode: number
): PlaybackPositionData {
    return position(seriesId * 100 + episode, 90, {
        contentType: 'episode',
        seriesXtreamId: seriesId,
        seasonNumber: 1,
        episodeNumber: episode,
        updatedAt: day,
    });
}

function episodes(seriesId: number, count: number): DashboardSeriesEpisodes {
    return {
        status: 'loaded',
        seasons: {
            '1': Array.from({ length: count }, (_, index) => ({
                id: String(seriesId * 100 + index + 1),
                season: 1,
                episode_num: index + 1,
            })) as XtreamSerieEpisode[],
        },
    };
}

describe('watched history', () => {
    const rows = signal<readonly UnifiedCollectionItem[]>([]);
    const active = signal(true);
    const expanded = signal(false);
    const page = signal(1);
    const catalog = signal(new Map<number, DashboardSeriesEpisodes>());
    const read = jest.fn<Promise<PlaybackPositionData[]>, [string]>();
    const request = jest.fn();
    const get = (entry: DashboardSeriesEpisodesRequest) =>
        catalog().get(entry.seriesId);

    function create() {
        return TestBed.runInInjectionContext(() =>
            createWatchedHistory({ items: rows, active, expanded, page })
        );
    }

    async function settle() {
        TestBed.tick();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        TestBed.tick();
    }

    beforeEach(() => {
        rows.set([]);
        active.set(true);
        expanded.set(false);
        page.set(1);
        catalog.set(new Map());
        read.mockReset().mockResolvedValue([]);
        request.mockReset();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: Store,
                    useValue: {
                        selectSignal: () =>
                            signal([playlist('demo-a'), playlist('demo-b')]),
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: { getAllPlaybackPositions: read },
                },
                {
                    provide: DashboardSeriesEpisodesService,
                    useValue: { get, request },
                },
            ],
        });
    });

    it('includes only finished movies and keeps history order and scope', async () => {
        rows.set([
            item(2),
            item(3, 'live'),
            item(1),
            item(4, 'movie', 'demo-b'),
        ]);
        read.mockImplementation(async (id) =>
            id === 'demo-a'
                ? [position(1, 89), position(2, 90), position(3, 100)]
                : [position(4, 0, { watched: true })]
        );
        const history = create();
        await settle();
        expect(history.items().map((entry) => entry.uid)).toEqual([
            'demo-a:movie:2',
            'demo-b:movie:4',
        ]);
        expect(read.mock.calls).toEqual([['demo-a'], ['demo-b']]);
        expect(request).not.toHaveBeenCalled();

        read.mockResolvedValue([position(1, 89)]);
        announceActivityChange();
        await settle();
        expect(history.items()).toEqual([]);
    });

    it('requires all episodes even when the series has reached the finale', async () => {
        rows.set([item(1, 'series'), item(2, 'series'), item(3, 'series')]);
        catalog.set(
            new Map([
                [1, episodes(1, 2)],
                [2, episodes(2, 2)],
            ])
        );
        read.mockResolvedValue([
            episodePosition(1, 1),
            episodePosition(1, 2),
            episodePosition(2, 2),
            episodePosition(3, 1),
        ]);
        const history = create();
        await settle();
        expect(history.items().map((entry) => entry.xtreamId)).toEqual([1]);

        catalog.set(
            new Map([
                [1, episodes(1, 3)],
                [2, episodes(2, 2)],
            ])
        );
        await settle();
        expect(history.items()).toEqual([]);
    });

    it('opens the parent series for legacy episode-keyed Xtream history', async () => {
        rows.set([item(101, 'series')]);
        catalog.set(new Map([[1, episodes(1, 1)]]));
        read.mockResolvedValue([episodePosition(1, 1)]);
        const history = create();
        await settle();

        expect(history.items()).toEqual([
            expect.objectContaining({
                xtreamId: 1,
                uid: 'xtream::demo-a::series:1',
            }),
        ]);
    });

    it('limits the preview and requests the next batch only from the full view', async () => {
        const ids = Array.from({ length: 43 }, (_, index) => index + 1);
        rows.set(ids.map((id) => item(id, 'series')));
        catalog.set(new Map(ids.map((id) => [id, episodes(id, 1)])));
        read.mockResolvedValue(ids.map((id) => episodePosition(id, 1)));
        const history = create();
        await settle();
        expect(request.mock.lastCall?.[0]).toHaveLength(12);
        expect(history.items()).toHaveLength(8);
        expect(history.hasMore()).toBe(true);

        expanded.set(true);
        await settle();
        expect(request.mock.lastCall?.[0]).toHaveLength(20);
        expect(history.items()).toHaveLength(20);
        page.set(2);
        await settle();
        expect(history.items()).toHaveLength(40);
        expect(history.hasMore()).toBe(true);
        page.set(3);
        await settle();
        expect(history.items()).toHaveLength(43);
        expect(history.hasMore()).toBe(false);
    });

    it('ignores an older playback read after the active playlist changes', async () => {
        let finishOld: (positions: PlaybackPositionData[]) => void = () => {
            throw new Error('The old read was never started');
        };
        const old = new Promise<PlaybackPositionData[]>((resolve) => {
            finishOld = resolve;
        });
        rows.set([item(1)]);
        read.mockReturnValueOnce(old).mockResolvedValueOnce([position(2, 95)]);
        const history = create();
        await settle();
        expect(history.loading()).toBe(true);

        rows.set([item(2, 'movie', 'demo-b')]);
        await settle();
        expect(history.items().map((entry) => entry.xtreamId)).toEqual([2]);
        finishOld([position(1, 100)]);
        await settle();
        expect(history.items().map((entry) => entry.xtreamId)).toEqual([2]);
    });

    it('offers another batch after an empty preview with more candidates', async () => {
        const ids = Array.from({ length: 13 }, (_, index) => index + 1);
        rows.set(ids.map((id) => item(id, 'series')));
        catalog.set(
            new Map(
                ids.map((id) => [
                    id,
                    id === 13 ? episodes(id, 1) : { status: 'failed' },
                ])
            )
        );
        read.mockResolvedValue(ids.map((id) => episodePosition(id, 1)));
        const history = create();
        await settle();
        expect(history.items()).toEqual([]);
        expect(history.loading()).toBe(false);
        expect(history.hasMore()).toBe(true);

        expanded.set(true);
        await settle();
        expect(history.items().map((entry) => entry.xtreamId)).toEqual([13]);
        expect(history.hasMore()).toBe(false);
    });
});
