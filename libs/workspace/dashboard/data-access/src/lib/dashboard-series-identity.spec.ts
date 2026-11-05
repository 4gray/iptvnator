import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY } from 'rxjs';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import type {
    PlaybackPositionData,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import { DashboardDataService } from './dashboard-data.service';
import { DashboardSeriesEpisodesService } from './dashboard-series-episodes.service';

describe('Dashboard series and episode identity collisions', () => {
    const item: PortalRecentItem = {
        id: 1,
        xtream_id: 100,
        type: 'series',
        source: 'xtream',
        title: 'Example Series',
        category_id: 10,
        playlist_id: 'example-source',
        viewed_at: '2026-01-01T00:00:00Z',
    };
    const own: PlaybackPositionData = {
        playlistId: item.playlist_id,
        contentType: 'episode',
        contentXtreamId: 101,
        seriesXtreamId: 100,
        seasonNumber: 1,
        episodeNumber: 2,
        positionSeconds: 120,
        durationSeconds: 1200,
        updatedAt: '2026-01-01T00:00:00Z',
    };
    const foreign: PlaybackPositionData = {
        ...own,
        contentXtreamId: 100,
        seriesXtreamId: 200,
        episodeNumber: 9,
        updatedAt: '2026-01-02T00:00:00Z',
    };
    let service: DashboardDataService;
    let rows: PlaybackPositionData[];
    const save = jest.fn().mockResolvedValue(undefined);

    beforeEach(async () => {
        rows = [own, foreign];
        save.mockClear();
        TestBed.configureTestingModule({
            providers: [
                DashboardDataService,
                {
                    provide: Store,
                    useValue: {
                        selectSignal: (selector: unknown) =>
                            signal(
                                selector === selectAllPlaylistsMeta ? [] : true
                            ),
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: { getGlobalRecentlyViewed: async () => [item] },
                },
                { provide: XTREAM_DATA_SOURCE, useValue: {} },
                { provide: PlaylistsService, useValue: {} },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsPortalActivityStorage: true },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        onLangChange: EMPTY,
                        onDefaultLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getAllPlaybackPositions: async () => rows,
                        savePlaybackPositionOrThrow: save,
                    },
                },
                {
                    provide: DashboardSeriesEpisodesService,
                    useValue: {
                        episodes: signal(new Map()),
                        request: jest.fn(),
                    },
                },
            ],
        });
        service = TestBed.inject(DashboardDataService);
        await service.reloadGlobalRecentItems();
        await service.reloadPlaybackPositions();
    });

    it.each(['2026-01-02T00:00:00Z', own.updatedAt])(
        'keeps parent-series progress when an unrelated episode has timestamp %s',
        async (updatedAt) => {
            rows = [own, { ...foreign, updatedAt }];
            await service.reloadPlaybackPositions();
            expect(service.getPlaybackPositionForItem(item)).toEqual(own);
        }
    );

    it('opens the selected series detail without auto-playing the colliding episode', () => {
        expect(service.getRecentItemDetailNavigationState(item)).toEqual({
            collectionViewState: { scope: 'all' },
            openCollectionDetailItem: {
                item: expect.objectContaining({ xtreamId: 100 }),
            },
        });
    });

    it('resumes the selected series episode through both card and hero actions', () => {
        const expected = expect.objectContaining({
            openCollectionDetailItem: {
                item: expect.objectContaining({ xtreamId: 100 }),
                seriesResume: {
                    seriesXtreamId: 100,
                    contentXtreamId: 101,
                    seasonNumber: 1,
                    episodeNumber: 2,
                },
            },
        });
        expect(service.getRecentItemNavigationState(item)).toEqual(expected);
        expect(service.getRecentItemResumeNavigation(item)?.state).toEqual(
            expected
        );
    });

    it('marks only the selected series episode watched', async () => {
        await service.markRecentItemWatched(item);
        expect(save).toHaveBeenCalledWith(
            item.playlist_id,
            expect.objectContaining({
                contentXtreamId: own.contentXtreamId,
                seriesXtreamId: own.seriesXtreamId,
                positionSeconds: own.durationSeconds,
            })
        );
    });

    it('still resolves a legacy episode-keyed recent item when no parent-series position matches', () => {
        const legacy = { ...item, xtream_id: 101 };
        expect(service.getPlaybackPositionForItem(legacy)).toEqual(own);
        expect(service.getRecentItemResumeNavigation(legacy)?.state).toEqual(
            expect.objectContaining({
                openCollectionDetailItem: expect.objectContaining({
                    item: expect.objectContaining({ xtreamId: 100 }),
                }),
            })
        );
    });
});
