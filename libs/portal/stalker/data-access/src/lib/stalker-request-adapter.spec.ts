/* eslint-disable max-lines -- operation matrix intentionally exercises the complete boundary */
import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    type StalkerSessionApplicationOperation,
} from '@iptvnator/shared/interfaces';
import {
    adaptLegacyStalkerRequest,
    mapStalkerSessionResultToLegacyResponse,
    type StalkerLegacyRequestParameters,
} from './stalker-request-adapter';

describe('adaptLegacyStalkerRequest', () => {
    it.each([
        {
            legacy: {
                action: 'get_categories',
                type: 'vod',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
            parameters: {
                contentType: 'vod',
            },
        },
        {
            legacy: {
                action: 'get_genres',
                type: 'itv',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogGenres,
            parameters: {},
        },
        {
            legacy: {
                action: 'get_ordered_list',
                category: '7',
                genre: '9',
                movie_id: '42',
                p: '3',
                search: 'needle',
                season_id: '4',
                sortby: 'added',
                type: 'vod',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            parameters: {
                category: '7',
                contentType: 'vod',
                genre: '9',
                itemId: '42',
                page: 3,
                query: 'needle',
                seasonId: '4',
                sortBy: 'added',
            },
        },
        {
            legacy: {
                action: 'get_all_channels',
                type: 'itv',
            },
            operation:
                STALKER_SESSION_APPLICATION_OPERATIONS.CatalogAllChannels,
            parameters: {},
        },
        {
            legacy: {
                action: 'get_ordered_list',
                category: '*',
                genre: '0',
                max_page_items: 100,
                p: 2,
                search: 'film',
                sortby: 'added',
                type: 'vod',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogSearch,
            parameters: {
                category: '*',
                contentType: 'vod',
                page: 2,
                query: 'film',
            },
        },
        {
            legacy: {
                action: 'get_ordered_list',
                movie_id: '51',
                type: 'series',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.SeriesSeasons,
            parameters: {
                seriesId: '51',
            },
        },
        {
            legacy: {
                action: 'get_ordered_list',
                movie_id: '51',
                p: '1',
                season_id: '51:2',
                type: 'vod',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.SeriesEpisodes,
            parameters: {
                seasonId: '51:2',
                seriesId: '51',
            },
        },
        {
            legacy: {
                action: 'get_short_epg',
                ch_id: '11',
                size: '7',
                type: 'itv',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg,
            parameters: {
                channelId: '11',
                limit: 7,
            },
        },
        {
            legacy: {
                action: 'get_epg_info',
                from_timestamp: '100',
                period: '168',
                to_timestamp: 200,
                type: 'itv',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.EpgInfo,
            parameters: {
                fromTimestamp: 100,
                periodHours: 168,
                toTimestamp: 200,
            },
        },
        {
            legacy: {
                action: 'create_link',
                cmd: '/media/file_4.mpg',
                disable_ad: '0',
                download: '0',
                JsHttpRequest: '1-xml',
                series: '3',
                type: 'vod',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
            parameters: {
                command: '/media/file_4.mpg',
                contentType: 'episode',
                episodeNumber: 3,
            },
        },
        {
            legacy: {
                action: 'favorites',
                favorite: '1',
                item_id: '9',
                type: 'vod',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.Favorites,
            parameters: {
                contentType: 'vod',
                favorite: true,
                itemId: '9',
            },
        },
        {
            legacy: {
                action: 'get_main_info',
                JsHttpRequest: '1-xml',
                type: 'account_info',
            },
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo,
            parameters: {},
        },
    ] as const)(
        'maps a legacy call to $operation without raw wire/auth fields',
        ({ legacy, operation, parameters }) => {
            const adapted = adaptLegacyStalkerRequest(
                legacy as unknown as StalkerLegacyRequestParameters
            );

            expect(adapted).toEqual({
                operation,
                parameters,
            });
            expect(JSON.stringify(adapted)).not.toMatch(
                /"action"|"token"|"JsHttpRequest"|"mac"|"password"/
            );
        }
    );

    it('keeps a movie file lookup as catalog detail instead of misclassifying it as a season request', () => {
        expect(
            adaptLegacyStalkerRequest({
                action: 'get_ordered_list',
                movie_id: '42',
                p: '1',
                type: 'vod',
            })
        ).toEqual({
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            parameters: {
                contentType: 'vod',
                itemId: '42',
                page: 1,
            },
        });
    });

    it.each(['handshake', 'get_profile', 'do_auth'])(
        'rejects the raw auth action %s',
        (action) => {
            expect(() =>
                adaptLegacyStalkerRequest({
                    action,
                    type: 'stb',
                })
            ).toThrow('stalker-request-adapter-raw-auth-action');
        }
    );

    it.each([
        'token',
        'prehash',
        'auth_second_step',
        'login',
        'password',
        'mac',
        'serial',
        'device_id',
        'signature',
        'metrics',
        'stb_lang',
        'timezone',
    ])('rejects the reserved legacy parameter %s', (parameter) => {
        expect(() =>
            adaptLegacyStalkerRequest({
                action: 'get_ordered_list',
                [parameter]: 'renderer-owned-value',
                type: 'vod',
            })
        ).toThrow(`stalker-request-adapter-reserved-parameter:${parameter}`);
    });

    it('rejects unsupported or operation-incompatible legacy fields', () => {
        expect(() =>
            adaptLegacyStalkerRequest({
                action: 'unknown-action',
                type: 'vod',
            })
        ).toThrow('stalker-request-adapter-unsupported-operation');

        expect(() =>
            adaptLegacyStalkerRequest({
                action: 'get_categories',
                arbitrary: 'value',
                type: 'vod',
            })
        ).toThrow('stalker-request-adapter-unsupported-parameter:arbitrary');

        expect(() =>
            adaptLegacyStalkerRequest({
                action: 'create_link',
                cmd: '/movie',
                JsHttpRequest: 'renderer-owned-value',
                type: 'vod',
            })
        ).toThrow('stalker-request-adapter-reserved-parameter:JsHttpRequest');
    });
});

describe('mapStalkerSessionResultToLegacyResponse', () => {
    it('maps categories back to the existing category envelope', () => {
        expect(
            mapStalkerSessionResultToLegacyResponse(
                STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
                {
                    items: [
                        {
                            alias: 'movies',
                            censored: true,
                            id: '7',
                            name: 'Movies',
                            parentId: '1',
                        },
                    ],
                }
            )
        ).toEqual({
            js: [
                {
                    alias: 'movies',
                    censored: 1,
                    id: '7',
                    parent_id: '1',
                    title: 'Movies',
                },
            ],
        });
    });

    it.each([
        STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
        STALKER_SESSION_APPLICATION_OPERATIONS.CatalogAllChannels,
        STALKER_SESSION_APPLICATION_OPERATIONS.CatalogSearch,
    ] as const)('maps %s back to the ordered-list envelope', (operation) => {
        expect(
            mapStalkerSessionResultToLegacyResponse(operation, {
                hasMore: true,
                items: [
                    {
                        command: '/movie/4',
                        contentType: 'vod',
                        id: '4',
                        info: {
                            movieImage: '/poster.jpg',
                            originalName: 'Original',
                        },
                        isSeries: true,
                        name: 'Movie',
                        posterUrl: '/cover.jpg',
                        rating: 7.5,
                        seriesNumbers: [1, 2],
                    },
                ],
                page: 2,
                pageSize: 10,
                total: 25,
                totalPages: 3,
            })
        ).toEqual({
            js: {
                cur_page: 2,
                data: [
                    {
                        cmd: '/movie/4',
                        cover: '/cover.jpg',
                        id: '4',
                        info: {
                            movie_image: '/poster.jpg',
                            o_name: 'Original',
                        },
                        is_series: 1,
                        name: 'Movie',
                        rating_imdb: 7.5,
                        series: [1, 2],
                    },
                ],
                max_page_items: 10,
                total_items: 25,
                total_pages: 3,
            },
        });
    });

    it('maps season and episode detail results back to their current list shapes', () => {
        expect(
            mapStalkerSessionResultToLegacyResponse(
                STALKER_SESSION_APPLICATION_OPERATIONS.SeriesSeasons,
                {
                    seasons: [
                        {
                            command: '/series/42',
                            episodeNumbers: [3, 4],
                            id: '42:2',
                            isSeason: true,
                            number: 2,
                            title: 'Season 2',
                            videoId: '42',
                        },
                    ],
                }
            )
        ).toEqual({
            js: [
                {
                    cmd: '/series/42',
                    id: '42:2',
                    is_season: true,
                    name: 'Season 2',
                    season_number: 2,
                    series: [3, 4],
                    video_id: '42',
                },
            ],
        });

        expect(
            mapStalkerSessionResultToLegacyResponse(
                STALKER_SESSION_APPLICATION_OPERATIONS.SeriesEpisodes,
                {
                    episodes: [
                        {
                            command: '/episode/3',
                            episodeNumber: 3,
                            id: 'e3',
                            seasonId: '42:2',
                            seasonNumber: 2,
                            seriesId: '42',
                            thumbnailUrl: '/episode.jpg',
                            title: 'Episode 3',
                        },
                    ],
                }
            )
        ).toEqual({
            js: {
                data: [
                    {
                        cmd: '/episode/3',
                        cover: '/episode.jpg',
                        episode_num: 3,
                        id: 'e3',
                        name: 'Episode 3',
                        season_id: '42:2',
                        season_number: 2,
                        series_id: '42',
                        series_number: 3,
                    },
                ],
            },
        });
    });

    it.each([
        STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg,
        STALKER_SESSION_APPLICATION_OPERATIONS.EpgInfo,
    ] as const)('maps %s back to the current EPG array', (operation) => {
        expect(
            mapStalkerSessionResultToLegacyResponse(operation, {
                programs: [
                    {
                        channelId: '11',
                        description: 'Summary',
                        endsAt: 200,
                        id: 'p1',
                        startsAt: 100,
                        title: 'News',
                    },
                ],
            })
        ).toEqual({
            js: [
                {
                    ch_id: '11',
                    descr: 'Summary',
                    id: 'p1',
                    name: 'News',
                    start_timestamp: 100,
                    stop_timestamp: 200,
                },
            ],
        });
    });

    it('maps create-link, favorites, and main-info results without exposing opaque playback context data', () => {
        const createLink = mapStalkerSessionResultToLegacyResponse(
            STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
            {
                playbackContextRef: 'opaque-playback-context',
                streamUrl: 'https://media.example/stream',
                userAgent: 'main-owned-user-agent',
            }
        );
        expect(createLink).toEqual({
            js: {
                cmd: 'https://media.example/stream',
            },
        });
        expect(JSON.stringify(createLink)).not.toContain(
            'opaque-playback-context'
        );
        expect(JSON.stringify(createLink)).not.toContain(
            'main-owned-user-agent'
        );

        expect(
            mapStalkerSessionResultToLegacyResponse(
                STALKER_SESSION_APPLICATION_OPERATIONS.Favorites,
                {
                    favorite: true,
                    success: true,
                }
            )
        ).toEqual({
            js: true,
        });

        expect(
            mapStalkerSessionResultToLegacyResponse(
                STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo,
                {
                    account: {
                        accountBalance: '2.50',
                        expiresAt: '2030-01-01',
                        name: 'demo',
                        status: 'active',
                        tariffPlan: 'Basic',
                    },
                }
            )
        ).toEqual({
            js: {
                account_info: {
                    account_balance: '2.50',
                    expire_date: '2030-01-01',
                    login: 'demo',
                    status: 'active',
                    tariff_plan_name: 'Basic',
                },
            },
        });
    });

    it('rejects a result/operation mismatch instead of guessing a legacy shape', () => {
        expect(() =>
            mapStalkerSessionResultToLegacyResponse(
                'unsupported' as StalkerSessionApplicationOperation,
                {} as never
            )
        ).toThrow('stalker-request-adapter-unsupported-operation');
    });
});
