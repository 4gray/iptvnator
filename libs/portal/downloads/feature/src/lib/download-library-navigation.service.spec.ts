import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import {
    DatabaseService,
    type DownloadItem,
    PlaylistsService,
} from '@iptvnator/services';
import type { Playlist, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { DownloadLibraryNavigationService } from './download-library-navigation.service';

const PLAYLIST_ID = 'playlist-a';
const XTREAM_PLAYLIST = {
    _id: PLAYLIST_ID,
    title: 'Xtream source',
    importDate: '2026-07-30',
    lastUsage: '2026-07-30',
    count: 0,
    autoRefresh: false,
    portalUrl: 'https://xtream.example.test',
} satisfies Playlist;
const STALKER_PLAYLIST = {
    ...XTREAM_PLAYLIST,
    title: 'Stalker source',
    portalUrl: 'https://stalker.example.test',
    macAddress: '00:1A:79:12:34:56',
} satisfies Playlist;

type RouterFake = jest.Mocked<Pick<Router, 'navigate'>>;
type DatabaseFake = jest.Mocked<Pick<DatabaseService, 'getContentByXtreamId'>>;
type PlaylistsFake = jest.Mocked<
    Pick<PlaylistsService, 'getPlaylistById' | 'getPortalRecentlyViewed'>
>;

function download(overrides: Partial<DownloadItem> = {}): DownloadItem {
    return {
        id: 1,
        playlistId: PLAYLIST_ID,
        xtreamId: 41,
        contentType: 'vod',
        title: 'Downloaded title',
        url: 'https://media.example.test/video',
        posterUrl: 'https://media.example.test/poster.jpg',
        status: 'completed',
        fileAvailability: 'available',
        ...overrides,
    };
}

describe('DownloadLibraryNavigationService', () => {
    let navigation: DownloadLibraryNavigationService;
    let router: RouterFake;
    let db: DatabaseFake;
    let playlists: PlaylistsFake;

    beforeEach(() => {
        router = {
            navigate: jest.fn().mockResolvedValue(true),
        };
        db = {
            getContentByXtreamId: jest.fn().mockResolvedValue(null),
        };
        playlists = {
            getPlaylistById: jest.fn().mockReturnValue(of(XTREAM_PLAYLIST)),
            getPortalRecentlyViewed: jest.fn().mockReturnValue(of([])),
        };

        TestBed.configureTestingModule({
            providers: [
                DownloadLibraryNavigationService,
                { provide: Router, useValue: router },
                { provide: DatabaseService, useValue: db },
                { provide: PlaylistsService, useValue: playlists },
            ],
        });

        navigation = TestBed.inject(DownloadLibraryNavigationService);
    });

    describe('canOpen', () => {
        const availablePlaylistIds = new Set([PLAYLIST_ID]);

        it('accepts positive safe VOD, series, and episode fallback IDs', () => {
            expect(
                navigation.canOpen(
                    download({ xtreamId: Number.MAX_SAFE_INTEGER }),
                    availablePlaylistIds
                )
            ).toBe(true);
            expect(
                navigation.canOpen(
                    download({
                        contentType: 'episode',
                        xtreamId: 9,
                        seriesXtreamId: 72,
                    }),
                    availablePlaylistIds
                )
            ).toBe(true);
            expect(
                navigation.canOpen(
                    download({
                        contentType: 'episode',
                        xtreamId: 9,
                        seriesXtreamId: undefined,
                    }),
                    availablePlaylistIds
                )
            ).toBe(true);
        });

        it('rejects an item whose source playlist is absent', () => {
            expect(
                navigation.canOpen(download(), new Set(['playlist-b']))
            ).toBe(false);
        });

        it.each([
            ['missing', undefined as unknown as number],
            ['NaN', Number.NaN],
            ['positive infinity', Number.POSITIVE_INFINITY],
            ['negative infinity', Number.NEGATIVE_INFINITY],
            ['zero', 0],
            ['negative', -1],
            ['fractional', 4.5],
            ['unsafe', Number.MAX_SAFE_INTEGER + 1],
        ])('rejects a %s VOD target ID', (_label, xtreamId) => {
            expect(
                navigation.canOpen(download({ xtreamId }), availablePlaylistIds)
            ).toBe(false);
        });

        it('does not fall back when an episode has a malformed series ID', () => {
            expect(
                navigation.canOpen(
                    download({
                        contentType: 'episode',
                        xtreamId: 9,
                        seriesXtreamId: 0,
                    }),
                    availablePlaylistIds
                )
            ).toBe(false);
        });
    });

    it.each([
        ['missing', undefined as unknown as number],
        ['zero', 0],
        ['negative', -8],
        ['fractional', 8.5],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ])('does not resolve or navigate a %s target ID', async (_label, id) => {
        await expect(navigation.open(download({ xtreamId: id }))).resolves.toBe(
            false
        );
        expect(playlists.getPlaylistById).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('opens an Xtream VOD at its category detail route', async () => {
        db.getContentByXtreamId.mockResolvedValue({
            category_id: 7,
        } as never);

        await expect(navigation.open(download())).resolves.toBe(true);

        expect(db.getContentByXtreamId).toHaveBeenCalledWith(41, PLAYLIST_ID);
        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            PLAYLIST_ID,
            'vod',
            '7',
            '41',
        ]);
    });

    it('returns false when the router refuses an Xtream navigation', async () => {
        db.getContentByXtreamId.mockResolvedValue({
            category_id: 7,
        } as never);
        router.navigate.mockResolvedValue(false);

        await expect(navigation.open(download())).resolves.toBe(false);

        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            PLAYLIST_ID,
            'vod',
            '7',
            '41',
        ]);
    });

    it.each(['xtream', 'stalker'] as const)(
        'returns false instead of rejecting when %s navigation fails',
        async (source) => {
            if (source === 'stalker') {
                playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
            }
            router.navigate.mockRejectedValue(new Error('navigation rejected'));

            await expect(navigation.open(download())).resolves.toBe(false);

            expect(router.navigate).toHaveBeenCalledTimes(1);
        }
    );

    it('returns false when the Xtream content lookup fails', async () => {
        db.getContentByXtreamId.mockRejectedValue(new Error('database failed'));

        await expect(navigation.open(download())).resolves.toBe(false);

        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('opens an Xtream episode at its series detail route', async () => {
        const item = download({
            contentType: 'episode',
            xtreamId: 511,
            seriesXtreamId: 93,
        });
        db.getContentByXtreamId.mockResolvedValue({
            category_id: '12',
        } as never);

        await expect(navigation.open(item)).resolves.toBe(true);

        expect(db.getContentByXtreamId).toHaveBeenCalledWith(93, PLAYLIST_ID);
        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            PLAYLIST_ID,
            'series',
            '12',
            '93',
        ]);
    });

    it.each([
        ['missing', {}],
        ['null', { category_id: null }],
    ])(
        'falls back to the Xtream collection route for a %s category',
        async (_label, content) => {
            db.getContentByXtreamId.mockResolvedValue(content as never);

            await expect(navigation.open(download())).resolves.toBe(true);

            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'xtreams',
                PLAYLIST_ID,
                'vod',
            ]);
        }
    );

    it('returns false when the source playlist is missing', async () => {
        playlists.getPlaylistById.mockReturnValue(
            of(undefined as unknown as Playlist)
        );

        await expect(navigation.open(download())).resolves.toBe(false);

        expect(db.getContentByXtreamId).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('returns false when the source playlist lookup fails', async () => {
        playlists.getPlaylistById.mockReturnValue(
            throwError(() => new Error('lookup failed'))
        );

        await expect(navigation.open(download())).resolves.toBe(false);

        expect(db.getContentByXtreamId).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('opens a Stalker VOD at its canonical provider detail route', async () => {
        playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
        const recent = {
            movie_id: '41',
            category_id: 'vod',
            title: 'Recent title',
            name: 'Recent name',
        } satisfies StalkerPortalItem;
        playlists.getPortalRecentlyViewed.mockReturnValue(of([recent]));

        await expect(navigation.open(download())).resolves.toBe(true);

        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'stalker', PLAYLIST_ID, 'vod', 'vod'],
            {
                state: {
                    openStalkerItem: {
                        ...recent,
                        id: '41',
                        category_id: 'vod',
                    },
                },
            }
        );
    });

    it.each([
        ['is_series flag', { is_series: '1' }],
        ['embedded episode list', { series: [1, 2] }],
    ] as const)(
        'opens a recovered Stalker episode with an %s through the VOD-series detail route',
        async (_label, vodSeriesMetadata) => {
            playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
            const recent = {
                movie_id: '72',
                category_id: 'series',
                title: 'Recovered VOD series',
                name: 'Recovered VOD series',
                ...vodSeriesMetadata,
            } satisfies StalkerPortalItem;
            playlists.getPortalRecentlyViewed.mockReturnValue(of([recent]));

            await expect(
                navigation.open(
                    download({
                        contentType: 'episode',
                        xtreamId: 501,
                        seriesXtreamId: 72,
                    })
                )
            ).resolves.toBe(true);

            expect(router.navigate).toHaveBeenCalledWith(
                ['/workspace', 'stalker', PLAYLIST_ID, 'vod', 'vod'],
                {
                    state: {
                        openStalkerItem: {
                            ...recent,
                            id: '72',
                            name: 'Recovered VOD series',
                        },
                    },
                }
            );
            expect(router.navigate).not.toHaveBeenCalledWith(
                expect.arrayContaining(['recent']),
                expect.anything()
            );
        }
    );

    it.each(['id', 'movie_id', 'series_id', 'stream_id'] as const)(
        'matches a Stalker recent item by normalized %s',
        async (idKey) => {
            playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
            const recent = {
                [idKey]: '41:archive',
                category_id: 'series',
                title: 'Recent title',
                name: 'Recent name',
                preserved: 'yes',
            } satisfies StalkerPortalItem & { preserved: string };
            playlists.getPortalRecentlyViewed.mockReturnValue(of([recent]));

            await expect(navigation.open(download())).resolves.toBe(true);

            const expectedId = idKey === 'stream_id' ? '41' : recent[idKey];
            expect(router.navigate).toHaveBeenCalledWith(
                ['/workspace', 'stalker', PLAYLIST_ID, 'vod', 'series'],
                {
                    state: {
                        openStalkerItem: {
                            ...recent,
                            id: expectedId,
                            category_id: 'series',
                            title: 'Recent title',
                            name: 'Recent name',
                        },
                    },
                }
            );
        }
    );

    it('preserves a matched Stalker item and fills its normalized display fields', async () => {
        playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
        const recent = {
            series_id: '41:episode',
            category_id: 'movie',
            o_name: 'Portal original name',
            preserved: { token: 1 },
        } satisfies StalkerPortalItem & {
            preserved: { token: number };
        };
        playlists.getPortalRecentlyViewed.mockReturnValue(of([recent]));

        await expect(navigation.open(download())).resolves.toBe(true);

        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'stalker', PLAYLIST_ID, 'vod', 'vod'],
            {
                state: {
                    openStalkerItem: {
                        ...recent,
                        id: '41:episode',
                        category_id: 'vod',
                        title: 'Downloaded title',
                        name: 'Portal original name',
                    },
                },
            }
        );
    });

    it.each([
        ['VOD', 'vod', 'vod'],
        ['SERIES', 'series', 'vod'],
        ['ItV', 'itv', 'vod'],
        ['radio', 'vod', 'vod'],
        ['unknown', 'series', 'episode'],
    ] as const)(
        'normalizes Stalker category %s to %s',
        async (categoryId, expected, contentType) => {
            playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
            playlists.getPortalRecentlyViewed.mockReturnValue(
                of([
                    {
                        id: '41',
                        category_id: categoryId,
                    },
                ])
            );

            await navigation.open(download({ contentType }));

            expect(router.navigate).toHaveBeenCalledWith(
                [
                    '/workspace',
                    'stalker',
                    PLAYLIST_ID,
                    contentType === 'episode' ? 'series' : 'vod',
                    expected,
                ],
                {
                    state: {
                        openStalkerItem: expect.objectContaining({
                            category_id: expected,
                        }),
                    },
                }
            );
        }
    );

    it('uses download metadata when no Stalker recent item matches', async () => {
        playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
        playlists.getPortalRecentlyViewed.mockReturnValue(
            of([{ id: '999', category_id: 'vod' }])
        );

        await expect(navigation.open(download())).resolves.toBe(true);

        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'stalker', PLAYLIST_ID, 'vod', 'vod'],
            {
                state: {
                    openStalkerItem: {
                        id: '41',
                        category_id: 'vod',
                        title: 'Downloaded title',
                        name: 'Downloaded title',
                        o_name: 'Downloaded title',
                        cover: 'https://media.example.test/poster.jpg',
                        logo: 'https://media.example.test/poster.jpg',
                    },
                },
            }
        );
    });

    it('uses episode download metadata when Stalker recent loading fails', async () => {
        playlists.getPlaylistById.mockReturnValue(of(STALKER_PLAYLIST));
        playlists.getPortalRecentlyViewed.mockReturnValue(
            throwError(() => new Error('recent failed'))
        );
        const item = download({
            contentType: 'episode',
            xtreamId: 501,
            seriesXtreamId: 72,
        });

        await expect(navigation.open(item)).resolves.toBe(true);

        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'stalker', PLAYLIST_ID, 'series', 'series'],
            {
                state: {
                    openStalkerItem: {
                        id: '72',
                        category_id: 'series',
                        title: 'Downloaded title',
                        name: 'Downloaded title',
                        o_name: 'Downloaded title',
                        cover: 'https://media.example.test/poster.jpg',
                        logo: 'https://media.example.test/poster.jpg',
                    },
                },
            }
        );
        expect(router.navigate).not.toHaveBeenCalledWith(
            expect.arrayContaining(['recent']),
            expect.anything()
        );
    });
});
