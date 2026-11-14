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
import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { VodSourceResolverService } from './multi-source/vod-source-resolver.service';
import { SecondStreamCatalogService } from './second-stream-catalog.service';
import {
    SECOND_STREAM_HISTORY,
    SecondStreamCollectionService,
} from './second-stream-collection.service';
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

describe('SecondStreamVodService', () => {
    const source = {
        _id: 'synthetic-xtream',
        title: 'Synthetic Xtream',
        serverUrl: 'https://portal.example.test',
    };
    const credentials = {
        serverUrl: source.serverUrl,
        username: 'fixture-user',
        password: 'fixture-password',
        userAgent: 'Fixture player',
        referrer: 'https://portal.example.test/player',
        origin: source.serverUrl,
    };
    const movie: UnifiedCollectionItem = {
        uid: 'xtream::synthetic-xtream::movie:42',
        name: 'Synthetic movie',
        playlistId: source._id,
        playlistName: source.title,
        sourceType: 'xtream',
        contentType: 'movie',
        categoryId: 900,
        xtreamId: 42,
    };
    const series: UnifiedCollectionItem = {
        ...movie,
        uid: 'xtream::synthetic-xtream::series:42',
        name: 'Synthetic series',
        contentType: 'series',
    };
    const firstEpisode: XtreamSerieEpisode = {
        id: '77',
        title: 'Synthetic episode',
        season: 2,
        episode_num: 1,
        container_extension: 'mp4',
        info: [],
        custom_sid: '',
        added: '',
        direct_source: '',
    };
    const moviePosition: PlaybackPositionData = {
        contentType: 'vod',
        contentXtreamId: 42,
        positionSeconds: 120,
        durationSeconds: 600,
    };
    const episodePosition: PlaybackPositionData = {
        ...moviePosition,
        contentType: 'episode',
        contentXtreamId: 77,
        seriesXtreamId: 42,
    };
    const moviePlayback = {
        streamUrl: 'https://media.example.test/fixture.mp4',
        title: movie.name,
        isLive: false,
    };

    let service: SecondStreamVodService;
    let getPlaylistById: jest.Mock;
    let getPlaylist: jest.Mock;
    let getCategories: jest.Mock;
    let getContent: jest.Mock;
    let getSeriesInfo: jest.Mock;
    let getSeriesPlaybackPositions: jest.Mock;
    let getPlaybackPosition: jest.Mock;
    let resolveMovie: jest.Mock;
    let constructEpisodeUrl: jest.Mock;
    let browseStalker: jest.Mock;
    let resolveStalker: jest.Mock;
    let loadCollection: jest.Mock;
    let isAllowed: jest.Mock;
    let signal: AbortSignal;

    beforeEach(() => {
        signal = new AbortController().signal;
        getPlaylistById = jest.fn(() => of(source));
        getPlaylist = jest.fn().mockResolvedValue(credentials);
        getCategories = jest.fn().mockResolvedValue([]);
        getContent = jest.fn().mockResolvedValue([]);
        getSeriesInfo = jest.fn().mockResolvedValue({ episodes: {} });
        getSeriesPlaybackPositions = jest.fn().mockResolvedValue([]);
        getPlaybackPosition = jest.fn().mockResolvedValue(null);
        resolveMovie = jest.fn().mockResolvedValue({ playback: moviePlayback });
        constructEpisodeUrl = jest
            .fn()
            .mockReturnValue('https://media.example.test/episode.mp4');
        browseStalker = jest
            .fn()
            .mockResolvedValue({ items: [], hasMore: false });
        resolveStalker = jest.fn().mockResolvedValue(moviePlayback);
        loadCollection = jest.fn().mockResolvedValue([]);
        isAllowed = jest.fn().mockReturnValue(true);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: StalkerSecondStreamService,
                    useValue: {
                        browse: browseStalker,
                        resolve: resolveStalker,
                    },
                },
                {
                    provide: SecondStreamCollectionService,
                    useValue: { load: loadCollection },
                },
                {
                    provide: SecondStreamCatalogService,
                    useValue: { isAllowed },
                },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: { getPlaylist, getCategories, getContent },
                },
                { provide: XtreamApiService, useValue: { getSeriesInfo } },
                {
                    provide: XtreamUrlService,
                    useValue: { constructEpisodeUrl },
                },
                {
                    provide: VodSourceResolverService,
                    useValue: { resolve: resolveMovie },
                },
                { provide: PlaylistsService, useValue: { getPlaylistById } },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getPlaybackPosition,
                        getSeriesPlaybackPositions,
                    },
                },
            ],
        });
        service = TestBed.inject(SecondStreamVodService);
    });

    it('uses provider identities and omits hidden, unknown and locked Xtream categories', async () => {
        getCategories.mockResolvedValue([
            { id: 50, xtream_id: 900, hidden: false },
            { id: 51, xtream_id: 901, hidden: true },
            { category_id: '902' },
        ]);
        getContent.mockResolvedValue([
            {
                id: 10,
                xtream_id: 42,
                category_id: 50,
                title: movie.name,
                poster_url: 'https://media.example.test/poster.jpg',
            },
            { id: 11, xtream_id: 43, category_id: 51, title: 'Hidden movie' },
            { stream_id: 44, category_id: '902', name: 'Locked movie' },
            { stream_id: 45, category_id: '903', name: 'Uncategorized movie' },
            { stream_id: -1, category_id: '902', name: 'Invalid movie' },
        ]);
        isAllowed.mockImplementation(
            (item: UnifiedCollectionItem) => item.categoryId !== 902
        );

        expect(
            await service.browse(
                source._id,
                'movie',
                signal,
                '',
                1,
                new Set(),
                new Set()
            )
        ).toEqual({
            items: [
                {
                    ...movie,
                    posterUrl: 'https://media.example.test/poster.jpg',
                },
            ],
            hasMore: false,
        });
        expect(getCategories).toHaveBeenCalledWith(
            source._id,
            credentials,
            'vod',
            { signal }
        );
        expect(isAllowed).toHaveBeenCalledTimes(2);
        expect(isAllowed).toHaveBeenCalledWith(
            expect.objectContaining({ xtreamId: 44, categoryId: 902 })
        );
    });

    it('normalizes series returned by the Xtream web data source', async () => {
        getCategories.mockResolvedValue([{ category_id: '900' }]);
        getContent.mockResolvedValue([
            {
                series_id: '42',
                category_id: '900',
                name: series.name,
                cover: 'https://media.example.test/series.jpg',
            },
        ]);

        expect(
            await service.browse(
                source._id,
                'series',
                signal,
                '',
                1,
                new Set(),
                new Set()
            )
        ).toEqual({
            items: [
                {
                    ...series,
                    posterUrl: 'https://media.example.test/series.jpg',
                },
            ],
            hasMore: false,
        });
        expect(getCategories).toHaveBeenCalledWith(
            source._id,
            credentials,
            'series',
            { signal }
        );
    });

    it('rechecks collection rows and keeps Stalker pagination state after filtering', async () => {
        const locked = { ...movie, uid: 'locked' };
        isAllowed.mockImplementation(
            (item: UnifiedCollectionItem) => item.uid !== 'locked'
        );
        loadCollection.mockResolvedValue([movie, locked]);
        expect(
            await service.browse(
                SECOND_STREAM_HISTORY,
                'movie',
                signal,
                '',
                1,
                new Set(),
                new Set()
            )
        ).toEqual({ items: [movie], hasMore: false });
        expect(loadCollection).toHaveBeenCalledWith(
            SECOND_STREAM_HISTORY,
            'movie',
            signal
        );

        const stalker = { ...source, macAddress: '02:00:00:00:00:02' };
        const item: UnifiedCollectionItem = {
            ...movie,
            sourceType: 'stalker',
            stalkerId: 42,
        };
        const seenPages = new Set(['page-1']);
        const exhaustedCatalogs = new Set(['series'] as const);
        getPlaylistById.mockReturnValue(of(stalker));
        browseStalker.mockResolvedValue({
            items: [item, locked],
            hasMore: true,
            pageKeys: ['page-2'],
            exhaustedCatalogs: ['series'],
        });

        expect(
            await service.browse(
                source._id,
                'movie',
                signal,
                'test',
                2,
                seenPages,
                exhaustedCatalogs
            )
        ).toEqual({
            items: [item],
            hasMore: true,
            pageKeys: ['page-2'],
            exhaustedCatalogs: ['series'],
        });
        expect(browseStalker).toHaveBeenCalledWith(
            stalker,
            'movie',
            'test',
            2,
            signal,
            seenPages,
            exhaustedCatalogs
        );
        expect(getCategories).not.toHaveBeenCalled();
    });

    it('offers no VOD for a local playlist and rejects aborted portal lookups', async () => {
        getPlaylistById.mockReturnValueOnce(of({ _id: 'synthetic-m3u' }));
        expect(
            await service.browse(
                'synthetic-m3u',
                'movie',
                signal,
                '',
                1,
                new Set(),
                new Set()
            )
        ).toEqual({ items: [], hasMore: false });

        const controller = new AbortController();
        const reason = new Error('Closed picker');
        controller.abort(reason);
        await expect(
            service.browse(
                source._id,
                'movie',
                controller.signal,
                '',
                1,
                new Set(),
                new Set()
            )
        ).rejects.toBe(reason);
        expect(getPlaylist).not.toHaveBeenCalled();
    });

    it('groups Xtream episodes by season, sorts them and joins saved positions by episode id', async () => {
        const later = { ...firstEpisode, id: '78', episode_num: 2 };
        const otherSeason = { ...firstEpisode, id: '99', season: 12 };
        getSeriesInfo.mockResolvedValue({
            episodes: {
                2: [later, firstEpisode, { id: 'invalid' }],
                12: [otherSeason],
                13: null,
            },
        });
        getSeriesPlaybackPositions.mockResolvedValue([episodePosition]);

        expect(await service.episodes(series, signal)).toEqual([
            { episode: firstEpisode, season: 2, position: episodePosition },
            { episode: later, season: 2, position: null },
            { episode: otherSeason, season: 12, position: null },
        ]);
        expect(getSeriesInfo).toHaveBeenCalledWith(credentials, 42, { signal });
        expect(getSeriesPlaybackPositions).toHaveBeenCalledWith(source._id, 42);
    });

    it('passes movie identity and resume position to the existing Xtream resolver', async () => {
        getPlaybackPosition.mockResolvedValueOnce(moviePosition);
        await expect(service.resolveMovie(movie)).resolves.toEqual({
            item: movie,
            playback: moviePlayback,
        });
        expect(getPlaybackPosition).toHaveBeenCalledWith(source._id, 42, 'vod');
        expect(resolveMovie).toHaveBeenCalledWith(
            expect.objectContaining({
                id: movie.uid,
                contentId: 42,
                playlistId: source._id,
                portalType: 'xtream',
            }),
            { startTime: 120, categoryId: 900, isCurrent: expect.any(Function) }
        );

        getPlaybackPosition.mockResolvedValueOnce({
            ...moviePosition,
            watched: true,
        });
        resolveMovie.mockResolvedValueOnce(null);
        await expect(service.resolveMovie(movie)).rejects.toThrow(
            'Movie unavailable'
        );
        expect(resolveMovie).toHaveBeenLastCalledWith(
            expect.any(Object),
            expect.objectContaining({ startTime: undefined })
        );
    });

    it('rejects a movie when its category locks while playback is being resolved', async () => {
        resolveMovie.mockImplementation(
            async (_candidate, options: { isCurrent: () => boolean }) => {
                expect(options.isCurrent()).toBe(true);
                isAllowed.mockReturnValue(false);
                expect(options.isCurrent()).toBe(false);
                return { playback: moviePlayback };
            }
        );
        await expect(service.resolveMovie(movie)).rejects.toThrow(
            'Source unavailable'
        );
    });

    it('prefers an HTTP episode link and attaches the saved position and provider metadata', async () => {
        getPlaybackPosition.mockResolvedValue(episodePosition);
        const episode = {
            ...firstEpisode,
            direct_source: ' https://media.example.test/direct.mp4 ',
        };
        await expect(
            service.resolveEpisode(series, {
                episode,
                season: 2,
                position: null,
            })
        ).resolves.toEqual({
            item: series,
            playback: {
                streamUrl: 'https://media.example.test/direct.mp4',
                title: episode.title,
                thumbnail: undefined,
                isLive: false,
                startTime: 120,
                contentInfo: {
                    playlistId: source._id,
                    contentType: 'episode',
                    contentXtreamId: 77,
                    seriesXtreamId: 42,
                    seasonNumber: 2,
                    episodeNumber: 1,
                },
                userAgent: credentials.userAgent,
                referer: credentials.referrer,
                origin: credentials.origin,
            },
        });
        expect(getPlaybackPosition).toHaveBeenCalledWith(
            source._id,
            77,
            'episode'
        );
        expect(constructEpisodeUrl).not.toHaveBeenCalled();
    });

    it('falls back to constructing an episode URL and rejects unusable episode addresses', async () => {
        const episode = {
            ...firstEpisode,
            direct_source: 'file:///fixture',
            container_extension: ' mp4 ',
        };
        await expect(
            service.resolveEpisode(series, {
                episode,
                season: 2,
                position: null,
            })
        ).resolves.toMatchObject({
            playback: {
                streamUrl: 'https://media.example.test/episode.mp4',
                startTime: undefined,
            },
        });
        expect(constructEpisodeUrl).toHaveBeenCalledWith(credentials, {
            ...episode,
            container_extension: 'mp4',
        });
        await expect(
            service.resolveEpisode(series, {
                episode: { ...episode, container_extension: 'mp4/invalid' },
                season: 2,
                position: null,
            })
        ).rejects.toThrow('Episode unavailable');
        await expect(
            service.resolveEpisode(series, {
                episode: { ...episode, id: 'invalid' },
                season: 2,
                position: null,
            })
        ).rejects.toThrow('Episode unavailable');
        expect(constructEpisodeUrl).toHaveBeenCalledTimes(1);
    });

    it('resumes a Stalker movie from the resolved identity and checks that its playlist remains available', async () => {
        const stalker = {
            ...source,
            macAddress: '02:00:00:00:00:02',
            url: 'https://portal.example.test/portal.php',
        };
        const item: UnifiedCollectionItem = {
            ...movie,
            sourceType: 'stalker',
            stalkerId: 42,
        };
        const contentInfo = {
            playlistId: source._id,
            contentType: 'vod',
            contentXtreamId: 76,
        };
        const playback = { ...moviePlayback, contentInfo };
        getPlaylistById.mockReturnValue(of(stalker));
        resolveStalker.mockResolvedValue(playback);
        getPlaybackPosition.mockResolvedValue({
            ...moviePosition,
            contentXtreamId: 76,
        });

        await expect(service.resolveMovie(item)).resolves.toEqual({
            item,
            playback: { ...playback, startTime: 120 },
        });
        expect(resolveStalker).toHaveBeenCalledWith(
            { ...stalker, portalUrl: stalker.url },
            item,
            undefined
        );
        expect(getPlaybackPosition).toHaveBeenCalledWith(source._id, 76, 'vod');

        getPlaylistById.mockReturnValueOnce(of(null));
        await expect(service.resolveMovie(item)).rejects.toThrow(
            'Source unavailable'
        );
        expect(resolveStalker).toHaveBeenCalledTimes(1);
    });
});
