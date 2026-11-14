import { TestBed } from '@angular/core/testing';
import { DataService, ParentalLockService } from '@iptvnator/services';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import type { StalkerVodSource } from './models';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import type { StalkerMappedEpisode } from './stalker-series.adapters';
import { StalkerEpisodeResolver } from './stalker-episode-resolver.service';
import { StalkerFavoritePlaybackResolver } from './stalker-favorite-playback.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import {
    StalkerSecondStreamService,
    stalkerSecondStreamType,
} from './stalker-second-stream.service';
import { StalkerSessionService } from './stalker-session.service';

describe('Stalker second stream', () => {
    const playlist: PlaylistMeta = {
        _id: 'portal-a',
        title: 'Fixture portal',
        count: 0,
        importDate: '',
        autoRefresh: false,
        portalUrl: 'https://portal.example.test/portal.php',
        macAddress: '02:00:00:00:00:01',
        isFullStalkerPortal: false,
    };
    const sendIpcEvent = jest.fn();
    const metadata = jest.fn();
    const resolveCommand = jest.fn();
    const seriesItem = (
        stalkerItem: UnifiedCollectionItem['stalkerItem'] = {},
        overrides: Partial<UnifiedCollectionItem> = {}
    ): UnifiedCollectionItem => ({
        uid: 'synthetic-series',
        name: 'Synthetic series',
        sourceType: 'stalker',
        contentType: 'series',
        playlistId: playlist._id,
        playlistName: playlist.title,
        stalkerId: '42',
        posterUrl: 'https://art.example.test/series.png',
        stalkerItem,
        ...overrides,
    });
    let service: StalkerSecondStreamService;
    const load = (
        page: number,
        seenPages = new Set<string>(),
        exhaustedCatalogs = new Set<'vod' | 'series'>()
    ) =>
        service.browse(
            playlist,
            'series',
            '',
            page,
            new AbortController().signal,
            seenPages,
            exhaustedCatalogs
        );

    beforeEach(() => {
        sendIpcEvent.mockReset();
        metadata.mockReset();
        resolveCommand.mockReset();
        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: { sendIpcEvent } },
                {
                    provide: ParentalLockService,
                    useValue: {
                        withholdsEverything: () => false,
                        active: () => false,
                        isStalkerCategoryLocked: () => false,
                        lockedStalkerIds: () => [],
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        ensureToken: jest.fn().mockResolvedValue({}),
                        getCachedToken: () => 'synthetic-token',
                    },
                },
                {
                    provide: StalkerPortalRepairService,
                    useValue: {
                        applyOverride: (value: unknown) => value,
                        shouldAttemptRepair: () => false,
                    },
                },
                {
                    provide: StalkerEpisodeResolver,
                    useValue: { resolveCommand },
                },
                {
                    provide: StalkerFavoritePlaybackResolver,
                    useValue: {
                        metadata,
                        resolve: (
                            _playlist: PlaylistMeta,
                            item: StalkerVodSource
                        ) => item,
                    },
                },
            ],
        });
        service = TestBed.inject(StalkerSecondStreamService);
    });

    it.each([true, false])(
        'limits playback header overrides to portal-owned streams (%s)',
        async (portalOwned) => {
            const streamUrl = portalOwned
                ? 'https://portal.example.test/media/fixture.mpg'
                : 'https://media.example.test/fixture.mpg';
            const origin = 'https://origin.example.test';
            const referrer = 'https://referer.example.test/player';
            sendIpcEvent.mockResolvedValue({ js: { cmd: streamUrl } });
            const playback = await service.resolve(
                { ...playlist, origin, referrer },
                {
                    uid: 'fixture-movie',
                    name: 'Fixture movie',
                    playlistId: playlist._id,
                    playlistName: playlist.title,
                    sourceType: 'stalker',
                    contentType: 'movie',
                    stalkerId: 42,
                    stalkerItem: { cmd: '/media/file_42.mpg' },
                }
            );
            expect(playback.streamUrl).toBe(streamUrl);
            expect(playback.headers?.['Origin']).toBe(
                portalOwned ? origin : undefined
            );
            expect(playback.headers?.['Referer']).toBe(
                portalOwned ? referrer : undefined
            );
            expect(playback.headers?.['Authorization']).toBe(
                portalOwned ? 'Bearer synthetic-token' : undefined
            );
        }
    );

    it('rejects an incomplete combined page so the caller can retry it', async () => {
        sendIpcEvent.mockImplementation((_event, request) =>
            request.params.type === 'series'
                ? Promise.reject(new Error('Synthetic provider failure'))
                : Promise.resolve({ js: { data: [] } })
        );
        await expect(load(1)).rejects.toThrow('Synthetic provider failure');
    });

    it('withholds the catalog without contacting a provider while parental locks are unavailable', async () => {
        jest.spyOn(
            TestBed.inject(ParentalLockService),
            'withholdsEverything'
        ).mockReturnValue(true);
        await expect(load(1)).resolves.toEqual({ items: [], hasMore: false });
        expect(sendIpcEvent).not.toHaveBeenCalled();
    });

    it('stops repeated raw pages but keeps paging through filtered-out rows', async () => {
        sendIpcEvent.mockImplementation((_event, { params }) =>
            Promise.resolve({
                js: {
                    data:
                        params.type === 'series'
                            ? [{ id: 'regular', name: 'Fixture series' }]
                            : [
                                  {
                                      id: `movie-${params.p}`,
                                      name: 'Fixture movie',
                                      is_series: 0,
                                  },
                              ],
                    total_items: 20,
                },
            })
        );
        const first = await load(1);
        expect(first.items.map((row) => row.name)).toEqual(['Fixture series']);
        const second = await load(2, new Set(first.pageKeys));
        expect(second).toMatchObject({
            items: [],
            hasMore: true,
            exhaustedCatalogs: ['series'],
        });

        await load(
            3,
            new Set(second.pageKeys),
            new Set(second.exhaustedCatalogs)
        );
        expect(
            sendIpcEvent.mock.calls.filter(
                ([, request]) => request.params.p === 3
            )
        ).toHaveLength(1);
    });

    it.each([
        [{ favoriteContentType: 'series', is_series: '1' }, 'series'],
        [{ favoriteContentType: 'vod' }, 'vod'],
        [{ series: [1, 2] }, 'vod'],
        [{ is_series: 1 }, 'vod'],
        [{}, 'series'],
    ] as const)('retains series catalog origin for %j', (raw, expected) => {
        expect(stalkerSecondStreamType(seriesItem({ ...raw }))).toBe(expected);
    });

    it('collects and orders regular seasons without hydrating the VOD catalog', async () => {
        sendIpcEvent.mockImplementation((_event, { params }) =>
            Promise.resolve({
                js: {
                    data:
                        params.p === 1
                            ? [
                                  {
                                      id: 'season-10',
                                      name: 'Season 10',
                                      cmd: '/media/season-ten',
                                      series: ['3'],
                                  },
                              ]
                            : [
                                  {
                                      id: 'season-2',
                                      name: 'Season 2',
                                      cmd: '/media/season-two',
                                      series: ['1', '2'],
                                  },
                              ],
                    total_items: 2,
                    max_page_items: 1,
                },
            })
        );
        const episodes = await service.episodes(
            playlist,
            seriesItem(),
            new AbortController().signal
        );
        expect(
            Object.values(episodes).map((season) =>
                season.map((episode) => episode.episode_num)
            )
        ).toEqual([[1, 2], [3]]);
        expect(episodes['1'][0]).toMatchObject({
            originalCmd: '/media/season-two',
            info: { movie_image: 'https://art.example.test/series.png' },
            activityIdentity: {
                provider: 'stalker',
                mode: 'regular',
                seriesId: '42',
                seasonKey: 'season-2',
                episodeNumber: 1,
            },
        });
        expect(
            sendIpcEvent.mock.calls.map(([, request]) => request.params)
        ).toEqual([
            {
                action: 'get_ordered_list',
                movie_id: '42',
                type: 'series',
                p: 1,
            },
            {
                action: 'get_ordered_list',
                movie_id: '42',
                type: 'series',
                p: 2,
            },
        ]);
        expect(metadata).not.toHaveBeenCalled();
    });

    it('uses an embedded episode list directly and hydrates a sparse VOD favorite only when needed', async () => {
        const raw = {
            id: '42',
            favoriteContentType: 'vod',
            cmd: '/media/embedded',
            series: [1, 2],
        };
        const embedded = await service.episodes(
            playlist,
            seriesItem(raw),
            new AbortController().signal
        );
        expect(embedded['1'].map((episode) => episode.episode_num)).toEqual([
            1, 2,
        ]);
        expect(embedded['1'][0].activityIdentity).toMatchObject({
            mode: 'embedded',
            seriesId: '42',
        });
        expect(metadata).not.toHaveBeenCalled();
        metadata.mockResolvedValue(raw);
        const hydrated = await service.episodes(
            playlist,
            seriesItem({ favoriteContentType: 'vod' }),
            new AbortController().signal
        );
        expect(hydrated).toEqual(embedded);
        expect(metadata).toHaveBeenCalledWith(
            playlist,
            expect.objectContaining({ id: '42', favoriteContentType: 'vod' })
        );
        expect(sendIpcEvent).not.toHaveBeenCalled();
    });

    it('traverses lazy VOD seasons using provider coordinates and keeps scoped playback identities', async () => {
        sendIpcEvent.mockImplementation((_event, { params }) => {
            if (!params.season_id)
                return Promise.resolve({
                    js: [
                        {
                            id: 'season-2',
                            video_id: 'video-2',
                            season_number: '2',
                            is_season: true,
                        },
                        { id: 'ignored-file', is_season: false },
                        {
                            id: 'season-1',
                            video_id: 'video-1',
                            season_number: '1',
                            is_season: true,
                        },
                    ],
                });
            return Promise.resolve({
                js: [
                    {
                        id: 'episode-1',
                        series_number: 1,
                        name: 'Synthetic premiere',
                        cmd: '/media/episode',
                        is_episode: true,
                    },
                    { id: 'ignored-season', is_episode: false },
                ],
            });
        });
        const item = seriesItem({ is_series: '1', favoriteContentType: 'vod' });
        const episodes = await service.episodes(
            playlist,
            item,
            new AbortController().signal
        );
        expect(Object.keys(episodes)).toEqual(['1', '2']);
        expect(episodes['1']).toHaveLength(1);
        expect(episodes['2']).toHaveLength(1);
        expect(episodes['1'][0].id).not.toBe(episodes['2'][0].id);
        expect(episodes['1'][0]).toMatchObject({
            originalId: 'episode-1',
            originalCmd: '/media/episode',
            vodEpisode: {
                movieId: 'video-1',
                seasonId: 'season-1',
                episodeId: 'episode-1',
            },
            activityIdentity: {
                mode: 'lazy',
                seriesId: '42',
                seasonKey: '1',
                episodeNumber: 1,
            },
        });
        expect(
            sendIpcEvent.mock.calls.map(([, request]) => request.params)
        ).toEqual([
            { action: 'get_ordered_list', movie_id: '42', type: 'vod', p: 1 },
            {
                action: 'get_ordered_list',
                movie_id: 'video-1',
                season_id: 'season-1',
                type: 'vod',
                p: 1,
            },
            {
                action: 'get_ordered_list',
                movie_id: 'video-2',
                season_id: 'season-2',
                type: 'vod',
                p: 1,
            },
        ]);
        const otherParent = await service.episodes(
            playlist,
            { ...item, stalkerId: '43' },
            new AbortController().signal
        );
        expect(otherParent['1'][0].id).not.toBe(episodes['1'][0].id);
    });

    it('retires a lazy traversal before loading episodes when its season reply arrives after cancellation', async () => {
        const abort = new AbortController();
        sendIpcEvent.mockImplementation(async () => {
            abort.abort();
            return {
                js: [{ id: 'season-1', video_id: '42', is_season: true }],
            };
        });
        await expect(
            service.episodes(
                playlist,
                seriesItem({ is_series: true }),
                abort.signal
            )
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(sendIpcEvent).toHaveBeenCalledTimes(1);
    });

    it('rejects a series without an identifier before fetching seasons', async () => {
        await expect(
            service.episodes(
                playlist,
                seriesItem({}, { stalkerId: '' }),
                new AbortController().signal
            )
        ).rejects.toThrow('Stalker series unavailable');
        expect(sendIpcEvent).not.toHaveBeenCalled();
    });

    it('discards embedded metadata resolved after cancellation', async () => {
        const abort = new AbortController();
        metadata.mockImplementation(async () => {
            abort.abort();
            return { id: '42', cmd: '/media/embedded', series: [1] };
        });
        await expect(
            service.episodes(
                playlist,
                seriesItem({ favoriteContentType: 'vod' }),
                abort.signal
            )
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(sendIpcEvent).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'resolves an episode with scoped progress metadata (lazy: %s)',
        async (lazy) => {
            const item = seriesItem({
                favoriteContentType: lazy ? 'vod' : 'series',
            });
            const identity = {
                provider: 'stalker',
                kind: 'episode',
                mode: lazy ? 'lazy' : 'regular',
                seriesId: '42',
                id: 'episode-1',
                seasonKey: 'provider-season',
                episodeNumber: 3,
            } as const;
            const episode: StalkerMappedEpisode = {
                id: '12345',
                episode_num: 3,
                season: 2,
                title: 'Synthetic episode',
                container_extension: 'mpg',
                custom_sid: '',
                added: '',
                direct_source: '',
                info: {},
                originalCmd: '/media/regular-season',
                activityIdentity: identity,
                ...(lazy
                    ? {
                          vodEpisode: {
                              movieId: '42',
                              seasonId: 'provider-season',
                              episodeId: 'episode-1',
                          },
                      }
                    : {}),
            };
            resolveCommand.mockResolvedValue('/media/file_201.mpg');
            sendIpcEvent.mockResolvedValue({
                js: { cmd: 'https://media.example.test/episode.mpg' },
            });
            const playback = await service.resolve(playlist, item, episode);
            expect(playback).toMatchObject({
                title: 'Synthetic episode',
                isLive: false,
                contentInfo: {
                    playlistId: playlist._id,
                    contentType: 'episode',
                    contentXtreamId: 12345,
                    seriesXtreamId: 42,
                    seasonNumber: 2,
                    episodeNumber: 3,
                    activityIdentity: identity,
                },
            });
            expect(sendIpcEvent).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    params: expect.objectContaining({
                        action: 'create_link',
                        series: '3',
                        cmd: lazy
                            ? '/media/file_201.mpg'
                            : '/media/regular-season',
                    }),
                })
            );
            if (lazy)
                expect(resolveCommand).toHaveBeenCalledWith(playlist, episode);
            else expect(resolveCommand).not.toHaveBeenCalled();
        }
    );

    it('resolves a movie file before minting its playback link', async () => {
        sendIpcEvent.mockImplementation((_event, { params }) =>
            Promise.resolve(
                params.action === 'get_ordered_list'
                    ? { js: { data: [{ id: '201' }] } }
                    : { js: { cmd: 'https://media.example.test/movie.mpg' } }
            )
        );
        const playback = await service.resolve(
            playlist,
            seriesItem(
                { cmd: '/media/movie', has_files: 1 },
                { contentType: 'movie' }
            )
        );
        expect(
            sendIpcEvent.mock.calls.map(([, request]) => request.params)
        ).toEqual([
            expect.objectContaining({
                action: 'get_ordered_list',
                movie_id: '42',
            }),
            expect.objectContaining({
                action: 'create_link',
                cmd: '/media/file_201.mpg',
            }),
        ]);
        expect(playback.contentInfo).toMatchObject({
            contentType: 'vod',
            contentXtreamId: 42,
        });
    });

    it('rejects missing commands without minting a playback link', async () => {
        await expect(
            service.resolve(playlist, seriesItem({}, { contentType: 'movie' }))
        ).rejects.toThrow('Stalker stream unavailable');
        expect(sendIpcEvent).not.toHaveBeenCalled();
    });

    it('plays string-identified movies without inventing numeric progress IDs', async () => {
        sendIpcEvent.mockResolvedValue({
            js: { cmd: 'https://media.example.test/movie.mpg' },
        });
        const playback = await service.resolve(
            playlist,
            seriesItem(
                { cmd: '/media/file_fixture.mpg' },
                { contentType: 'movie', stalkerId: 'movie-alpha' }
            )
        );
        expect(playback.contentInfo).toBeUndefined();
        expect(playback.title).toBe('Synthetic series');
        expect(playback.streamUrl).toBe('https://media.example.test/movie.mpg');
    });
});
