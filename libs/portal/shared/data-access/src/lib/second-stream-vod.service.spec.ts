import { TestBed } from '@angular/core/testing';
import {
    StalkerSecondStreamService,
    type StalkerMappedEpisode,
} from '@iptvnator/portal/stalker/data-access';
import {
    XTREAM_DATA_SOURCE,
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    PORTAL_PLAYBACK_POSITIONS,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { PlaylistsService } from '@iptvnator/services';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { VodSourceResolverService } from './multi-source/vod-source-resolver.service';
import { SecondStreamCatalogService } from './second-stream-catalog.service';
import { SecondStreamCollectionService } from './second-stream-collection.service';
import { SecondStreamVodService } from './second-stream-vod.service';

it('shows and resumes a compatible older Stalker episode under its scoped identity', async () => {
    const series: UnifiedCollectionItem = {
        uid: 'synthetic-series',
        name: 'Synthetic series',
        playlistId: 'synthetic-portal',
        playlistName: 'Synthetic portal',
        sourceType: 'stalker',
        contentType: 'series',
        stalkerId: 100,
    };
    const episode: StalkerMappedEpisode = {
        id: '600',
        title: 'Synthetic episode',
        season: 1,
        episode_num: 2,
        legacyTrackingId: 500,
        container_extension: 'mpg',
        info: {},
        custom_sid: '',
        added: '',
        direct_source: '',
    };
    const legacy: PlaybackPositionData = {
        contentType: 'episode',
        contentXtreamId: 500,
        seriesXtreamId: 100,
        seasonNumber: 1,
        episodeNumber: 2,
        positionSeconds: 120,
        durationSeconds: 600,
    };
    const contentInfo = {
        playlistId: series.playlistId,
        contentType: 'episode',
        contentXtreamId: 600,
        seriesXtreamId: 100,
    } as const;
    const getSeriesPlaybackPositions = jest.fn().mockResolvedValue([legacy]);
    TestBed.configureTestingModule({
        providers: [
            {
                provide: StalkerSecondStreamService,
                useValue: {
                    episodes: jest.fn().mockResolvedValue({ '1': [episode] }),
                    resolve: jest.fn().mockResolvedValue({
                        streamUrl: 'https://media.example.test/episode',
                        contentInfo,
                    }),
                },
            },
            { provide: SecondStreamCollectionService, useValue: {} },
            {
                provide: SecondStreamCatalogService,
                useValue: { isAllowed: () => true },
            },
            { provide: XTREAM_DATA_SOURCE, useValue: {} },
            { provide: XtreamApiService, useValue: {} },
            { provide: XtreamUrlService, useValue: {} },
            { provide: VodSourceResolverService, useValue: {} },
            {
                provide: PlaylistsService,
                useValue: {
                    getPlaylistById: () =>
                        of({
                            _id: series.playlistId,
                            macAddress: '00:1A:79:00:00:01',
                            portalUrl: 'https://portal.example.test/portal.php',
                        }),
                },
            },
            {
                provide: PORTAL_PLAYBACK_POSITIONS,
                useValue: { getSeriesPlaybackPositions },
            },
        ],
    });
    const service = TestBed.inject(SecondStreamVodService);
    const [row] = await service.episodes(series, new AbortController().signal);
    expect(row.position).toMatchObject({
        contentXtreamId: 600,
        positionSeconds: 120,
    });
    expect((await service.resolveEpisode(series, row)).playback).toMatchObject({
        contentInfo,
        startTime: 120,
    });

    getSeriesPlaybackPositions.mockResolvedValue([
        { ...legacy, episodeNumber: 3 },
    ]);
    expect(
        (await service.resolveEpisode(series, row)).playback.startTime
    ).toBeUndefined();
});
