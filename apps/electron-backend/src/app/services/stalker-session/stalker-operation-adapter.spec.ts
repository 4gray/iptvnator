import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    type StalkerSessionApplicationOperation,
    type StalkerSessionOperationParameters,
} from '@iptvnator/shared/interfaces';
import { mapRawOperation } from './stalker-operation-adapter';

function mapRemote<Operation extends StalkerSessionApplicationOperation>(
    operation: Operation,
    parameters: StalkerSessionOperationParameters<Operation>
) {
    const mapped = mapRawOperation(operation, parameters);
    if (mapped.kind !== 'remote') {
        throw new Error('expected-remote-operation');
    }
    return mapped;
}

describe('stalker-operation-adapter', () => {
    it.each([
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
            parameters: { contentType: 'vod' },
            wire: {
                action: 'get_categories',
                JsHttpRequest: '1-xml',
                type: 'vod',
            },
        },
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogGenres,
            parameters: {},
            wire: {
                action: 'get_genres',
                JsHttpRequest: '1-xml',
                type: 'itv',
            },
        },
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            parameters: {
                category: '7',
                contentType: 'series',
                genre: '9',
                itemId: '42',
                page: 3,
                query: 'needle',
                seasonId: '4',
                sortBy: 'added',
            },
            wire: {
                action: 'get_ordered_list',
                category: '7',
                genre: '9',
                JsHttpRequest: '1-xml',
                movie_id: '42',
                p: 3,
                search: 'needle',
                season_id: '4',
                sortby: 'added',
                type: 'series',
            },
        },
        {
            operation:
                STALKER_SESSION_APPLICATION_OPERATIONS.CatalogAllChannels,
            parameters: {},
            wire: {
                action: 'get_all_channels',
                JsHttpRequest: '1-xml',
                type: 'itv',
            },
        },
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogSearch,
            parameters: {
                category: '*',
                contentType: 'vod',
                page: 2,
                query: 'film',
            },
            wire: {
                action: 'get_ordered_list',
                category: '*',
                JsHttpRequest: '1-xml',
                max_page_items: 100,
                p: 2,
                search: 'film',
                type: 'vod',
            },
        },
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.SeriesSeasons,
            parameters: { seriesId: '51' },
            wire: {
                action: 'get_ordered_list',
                JsHttpRequest: '1-xml',
                movie_id: '51',
                type: 'series',
            },
        },
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.SeriesEpisodes,
            parameters: { seasonId: '51:2', seriesId: '51' },
            wire: {
                action: 'get_ordered_list',
                JsHttpRequest: '1-xml',
                movie_id: '51',
                p: 1,
                season_id: '51:2',
                type: 'vod',
            },
        },
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg,
            parameters: { channelId: '11', limit: 7 },
            wire: {
                action: 'get_short_epg',
                ch_id: '11',
                JsHttpRequest: '1-xml',
                size: 7,
                type: 'itv',
            },
        },
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.EpgInfo,
            parameters: {
                fromTimestamp: 100,
                periodHours: 168,
                toTimestamp: 200,
            },
            wire: {
                action: 'get_epg_info',
                from_timestamp: 100,
                JsHttpRequest: '1-xml',
                period: 168,
                to_timestamp: 200,
                type: 'itv',
            },
        },
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
            parameters: {
                command: '/media/file_4.mpg',
                contentType: 'episode',
                episodeNumber: 3,
                itemId: '4',
                seasonNumber: 2,
                seriesId: '9',
            },
            wire: {
                action: 'create_link',
                cmd: '/media/file_4.mpg',
                disable_ad: 0,
                download: 0,
                JsHttpRequest: '1-xml',
                series: 3,
                type: 'vod',
            },
        },
        {
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo,
            parameters: {},
            wire: {
                action: 'get_main_info',
                JsHttpRequest: '1-xml',
                type: 'account_info',
            },
        },
    ] as const)(
        'maps $operation to an exact main-owned wire request',
        ({ operation, parameters, wire }) => {
            expect(
                mapRemote(
                    operation,
                    parameters as StalkerSessionOperationParameters<
                        typeof operation
                    >
                ).parameters
            ).toEqual(wire);
        }
    );

    it('keeps favorites local and never constructs a portal request', () => {
        expect(
            mapRawOperation(STALKER_SESSION_APPLICATION_OPERATIONS.Favorites, {
                contentType: 'vod',
                favorite: true,
                itemId: '9',
            })
        ).toEqual({
            kind: 'local',
            result: {
                favorite: true,
                success: true,
            },
        });
    });

    it('normalizes catalog pages through an allowlist and drops secret-shaped raw fields', () => {
        const mapped = mapRemote(
            STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            {
                contentType: 'vod',
                page: 2,
            }
        );

        expect(
            mapped.mapResult({
                js: {
                    cur_page: '2',
                    data: [
                        {
                            actors: 'A, B',
                            cmd: 'ffmpeg http://media.invalid/4.ts',
                            id: '4',
                            info: {
                                description: 'Plot',
                                movie_image: '/poster.jpg',
                                token: 'must-not-cross',
                            },
                            is_series: '1',
                            name: 'Movie',
                            rating_imdb: '7.5',
                            screenshot_uri: '/shot.jpg',
                            series: ['1', 2, 'bad'],
                            token: 'must-not-cross',
                        },
                    ],
                    max_page_items: '10',
                    total_items: '25',
                    total_pages: '3',
                },
            })
        ).toEqual({
            hasMore: true,
            items: [
                {
                    actors: 'A, B',
                    command: 'ffmpeg http://media.invalid/4.ts',
                    contentType: 'vod',
                    id: '4',
                    info: {
                        description: 'Plot',
                        movieImage: '/poster.jpg',
                    },
                    isSeries: true,
                    name: 'Movie',
                    rating: 7.5,
                    seriesNumbers: [1, 2],
                    screenshotUrl: '/shot.jpg',
                },
            ],
            page: 2,
            pageSize: 10,
            total: 25,
            totalPages: 3,
        });
    });

    it('normalizes categories, seasons, episodes, EPG, links, and account summaries', () => {
        const categories = mapRemote(
            STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
            { contentType: 'series' }
        ).mapResult({
            js: [{ censored: '1', id: '7', title: 'Drama' }],
        });
        expect(categories).toEqual({
            items: [{ censored: true, id: '7', name: 'Drama' }],
        });

        const seasons = mapRemote(
            STALKER_SESSION_APPLICATION_OPERATIONS.SeriesSeasons,
            { seriesId: '42' }
        ).mapResult({
            js: [
                {
                    cmd: '/series/42',
                    id: '42:2',
                    name: 'Season 2',
                    series: ['3', 4],
                },
            ],
        });
        expect(seasons).toEqual({
            seasons: [
                {
                    command: '/series/42',
                    episodeNumbers: [3, 4],
                    id: '42:2',
                    number: 2,
                    title: 'Season 2',
                },
            ],
        });

        const episodes = mapRemote(
            STALKER_SESSION_APPLICATION_OPERATIONS.SeriesEpisodes,
            { seasonId: '42:2', seriesId: '42' }
        ).mapResult({
            js: {
                data: [
                    {
                        cmd: '/episode/3',
                        cover: '/episode.jpg',
                        episode_num: '3',
                        id: 'e3',
                        name: 'Episode 3',
                    },
                ],
            },
        });
        expect(episodes).toEqual({
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
        });

        const epg = mapRemote(STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg, {
            channelId: '11',
        }).mapResult({
            js: [
                {
                    ch_id: '11',
                    descr: 'Summary',
                    id: 'p1',
                    name: 'News',
                    start_timestamp: '100',
                    stop_timestamp: 200,
                },
            ],
        });
        expect(epg).toEqual({
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
        });

        const link = mapRemote(
            STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
            {
                command: 'http://media.invalid/live',
                contentType: 'itv',
            }
        ).mapResult({
            js: { cmd: 'ffmpeg http://media.invalid/live?token=synthetic' },
        });
        expect(link).toEqual({
            streamUrl: 'http://media.invalid/live?token=synthetic',
        });

        const mainInfo = mapRemote(
            STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo,
            {}
        ).mapResult({
            js: {
                account_info: {
                    account_balance: '2.50',
                    expire_date: '2030-01-01',
                    login: 'demo',
                    status: 1,
                    tariff_plan_name: 'Basic',
                    password: 'must-not-cross',
                },
            },
        });
        expect(mainInfo).toEqual({
            account: {
                accountBalance: '2.50',
                expiresAt: '2030-01-01',
                name: 'demo',
                status: '1',
                tariffPlan: 'Basic',
            },
        });
    });

    it('rejects invalid operation parameters before any wire request exists', () => {
        expect(() =>
            mapRawOperation(
                STALKER_SESSION_APPLICATION_OPERATIONS.CatalogSearch,
                {
                    contentType: 'vod',
                    query: '   ',
                }
            )
        ).toThrow('stalker-operation-invalid-parameters');

        expect(() =>
            mapRawOperation(STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink, {
                command: '',
                contentType: 'vod',
            })
        ).toThrow('stalker-operation-invalid-parameters');
    });
});
