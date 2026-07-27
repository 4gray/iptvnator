/* eslint-disable max-lines -- exhaustive legacy/typed boundary stays auditable in one module */
import {
    STALKER_RESERVED_REQUEST_PARAMETERS,
    validateStalkerApplicationRequest,
} from '@iptvnator/portal/stalker/protocol';
import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    type StalkerSessionApplicationOperation,
    type StalkerSessionCatalogInfo,
    type StalkerSessionCatalogItem,
    type StalkerSessionContentType,
    type StalkerSessionEntityId,
    type StalkerSessionOperationParameters,
    type StalkerSessionOperationResult,
} from '@iptvnator/shared/interfaces';

export type StalkerLegacyRequestParameters = Readonly<
    Record<string, string | number>
>;

export type StalkerAdaptedRequest = {
    [Operation in StalkerSessionApplicationOperation]: {
        readonly operation: Operation;
        readonly parameters: StalkerSessionOperationParameters<Operation>;
    };
}[StalkerSessionApplicationOperation];

const RAW_AUTH_ACTIONS = new Set(['do_auth', 'get_profile', 'handshake']);
const RESERVED_PARAMETERS = new Set<string>(
    STALKER_RESERVED_REQUEST_PARAMETERS
);
const CONTENT_TYPES = new Set<StalkerSessionContentType>([
    'itv',
    'radio',
    'series',
    'vod',
]);
const JS_HTTP_REQUEST = '1-xml';
const SEARCH_PAGE_SIZE = 100;

export function adaptLegacyStalkerRequest(
    legacy: StalkerLegacyRequestParameters
): StalkerAdaptedRequest {
    const action = readRequiredString(legacy['action']);
    if (RAW_AUTH_ACTIONS.has(action)) {
        throw adapterError('raw-auth-action');
    }
    assertNoReservedParameters(legacy);

    switch (action) {
        case 'get_categories':
            assertOnlyParameters(legacy, ['action', 'type']);
            return adapted(
                STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
                {
                    contentType: readContentType(legacy['type'], [
                        'radio',
                        'series',
                        'vod',
                    ]) as 'radio' | 'series' | 'vod',
                }
            );
        case 'get_genres':
            assertOnlyParameters(legacy, ['action', 'type']);
            assertExactValue(legacy['type'], 'itv');
            return adapted(
                STALKER_SESSION_APPLICATION_OPERATIONS.CatalogGenres,
                {}
            );
        case 'get_ordered_list':
            return adaptOrderedList(legacy);
        case 'get_all_channels':
            assertOnlyParameters(legacy, ['action', 'type']);
            assertExactValue(legacy['type'], 'itv');
            return adapted(
                STALKER_SESSION_APPLICATION_OPERATIONS.CatalogAllChannels,
                {}
            );
        case 'search':
            return adaptSearch(legacy);
        case 'get_short_epg':
            return adaptShortEpg(legacy);
        case 'get_epg_info':
            return adaptEpgInfo(legacy);
        case 'create_link':
            return adaptCreateLink(legacy);
        case 'favorites':
            return adaptFavorites(legacy);
        case 'get_main_info':
            assertOnlyParameters(legacy, ['action', 'JsHttpRequest', 'type']);
            assertJsHttpRequest(legacy);
            assertExactValue(legacy['type'], 'account_info');
            return adapted(STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo, {});
        default:
            throw adapterError('unsupported-operation');
    }
}

export function mapStalkerSessionResultToLegacyResponse<
    Operation extends StalkerSessionApplicationOperation,
>(
    operation: Operation,
    result: StalkerSessionOperationResult<Operation>
): unknown {
    switch (operation) {
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories:
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogGenres: {
            const categories = operationResult<
                | typeof STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories
                | typeof STALKER_SESSION_APPLICATION_OPERATIONS.CatalogGenres
            >(result);
            return {
                js: categories.items.map((item) =>
                    compact({
                        id: item.id,
                        title: item.name,
                        alias: item.alias,
                        censored: booleanFlag(item.censored),
                        parent_id: item.parentId,
                    })
                ),
            };
        }
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems:
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogAllChannels:
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogSearch: {
            const catalog = operationResult<
                | typeof STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems
                | typeof STALKER_SESSION_APPLICATION_OPERATIONS.CatalogAllChannels
                | typeof STALKER_SESSION_APPLICATION_OPERATIONS.CatalogSearch
            >(result);
            return {
                js: compact({
                    data: catalog.items.map(mapCatalogItemToLegacy),
                    cur_page: catalog.page,
                    max_page_items: catalog.pageSize,
                    total_items: catalog.total,
                    total_pages: catalog.totalPages,
                }),
            };
        }
        case STALKER_SESSION_APPLICATION_OPERATIONS.SeriesSeasons: {
            const seasons =
                operationResult<
                    typeof STALKER_SESSION_APPLICATION_OPERATIONS.SeriesSeasons
                >(result);
            return {
                js: seasons.seasons.map((season) =>
                    compact({
                        id: season.id,
                        is_season: season.isSeason,
                        season_number: season.number,
                        name: season.title,
                        cmd: season.command,
                        series: season.episodeNumbers,
                        video_id: season.videoId,
                    })
                ),
            };
        }
        case STALKER_SESSION_APPLICATION_OPERATIONS.SeriesEpisodes: {
            const episodes =
                operationResult<
                    typeof STALKER_SESSION_APPLICATION_OPERATIONS.SeriesEpisodes
                >(result);
            return {
                js: {
                    data: episodes.episodes.map((episode) =>
                        compact({
                            id: episode.id,
                            series_id: episode.seriesId,
                            season_id: episode.seasonId,
                            season_number: episode.seasonNumber,
                            series_number: episode.episodeNumber,
                            episode_num: episode.episodeNumber,
                            name: episode.title,
                            cmd: episode.command,
                            cover: episode.thumbnailUrl,
                            description: episode.description,
                            duration: episode.durationSeconds,
                        })
                    ),
                },
            };
        }
        case STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg:
        case STALKER_SESSION_APPLICATION_OPERATIONS.EpgInfo: {
            const epg = operationResult<
                | typeof STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg
                | typeof STALKER_SESSION_APPLICATION_OPERATIONS.EpgInfo
            >(result);
            return {
                js: epg.programs.map((program) =>
                    compact({
                        id: program.id,
                        ch_id: program.channelId,
                        name: program.title,
                        descr: program.description,
                        start_timestamp: program.startsAt,
                        stop_timestamp: program.endsAt,
                    })
                ),
            };
        }
        case STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink: {
            const link =
                operationResult<
                    typeof STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink
                >(result);
            return {
                js: {
                    cmd: link.streamUrl,
                },
            };
        }
        case STALKER_SESSION_APPLICATION_OPERATIONS.Favorites: {
            const favorites =
                operationResult<
                    typeof STALKER_SESSION_APPLICATION_OPERATIONS.Favorites
                >(result);
            return {
                js: favorites.success,
            };
        }
        case STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo: {
            const mainInfo =
                operationResult<
                    typeof STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo
                >(result);
            return {
                js: {
                    account_info: compact({
                        login: mainInfo.account.name,
                        status: mainInfo.account.status,
                        tariff_plan_name: mainInfo.account.tariffPlan,
                        account_balance: mainInfo.account.accountBalance,
                        expire_date: mainInfo.account.expiresAt,
                    }),
                },
            };
        }
        default:
            throw adapterError('unsupported-operation');
    }
}

function adaptOrderedList(
    legacy: StalkerLegacyRequestParameters
): StalkerAdaptedRequest {
    const contentType = readContentType(legacy['type']);
    const itemId = optionalEntityId(legacy['movie_id']);
    const seasonId = optionalEntityId(legacy['season_id']);
    const page = optionalPositiveInteger(legacy['p']);

    if (legacy['max_page_items'] !== undefined) {
        return adaptSearch(legacy);
    }

    if (
        contentType === 'vod' &&
        itemId !== undefined &&
        seasonId !== undefined &&
        page === 1
    ) {
        assertOnlyParameters(legacy, [
            'action',
            'movie_id',
            'p',
            'season_id',
            'type',
        ]);
        return adapted(STALKER_SESSION_APPLICATION_OPERATIONS.SeriesEpisodes, {
            seasonId,
            seriesId: itemId,
        });
    }

    if (contentType === 'series' && itemId !== undefined) {
        assertOnlyParameters(legacy, ['action', 'movie_id', 'type']);
        return adapted(STALKER_SESSION_APPLICATION_OPERATIONS.SeriesSeasons, {
            seriesId: itemId,
        });
    }

    assertOnlyParameters(legacy, [
        'action',
        'category',
        'genre',
        'movie_id',
        'p',
        'search',
        'season_id',
        'sortby',
        'type',
    ]);
    return adapted(
        STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
        compact({
            contentType,
            category: optionalEntityId(legacy['category']),
            genre: optionalEntityId(legacy['genre']),
            page,
            query: optionalString(legacy['search']),
            sortBy: optionalString(legacy['sortby']),
            itemId,
            seasonId,
        })
    );
}

function adaptSearch(
    legacy: StalkerLegacyRequestParameters
): StalkerAdaptedRequest {
    assertOnlyParameters(legacy, [
        'action',
        'category',
        'genre',
        'max_page_items',
        'p',
        'query',
        'search',
        'sortby',
        'type',
    ]);
    if (legacy['max_page_items'] !== undefined) {
        assertExactPositiveInteger(legacy['max_page_items'], SEARCH_PAGE_SIZE);
    }
    const query = readRequiredString(legacy['query'] ?? legacy['search']);
    return adapted(
        STALKER_SESSION_APPLICATION_OPERATIONS.CatalogSearch,
        compact({
            contentType: readContentType(legacy['type']),
            query,
            category: optionalEntityId(legacy['category']),
            page: optionalPositiveInteger(legacy['p']),
        })
    );
}

function adaptShortEpg(
    legacy: StalkerLegacyRequestParameters
): StalkerAdaptedRequest {
    assertOnlyParameters(legacy, [
        'action',
        'ch_id',
        'JsHttpRequest',
        'size',
        'type',
    ]);
    assertJsHttpRequest(legacy);
    assertExactValue(legacy['type'], 'itv');
    return adapted(
        STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg,
        compact({
            channelId: readEntityId(legacy['ch_id']),
            limit: optionalPositiveInteger(legacy['size']),
        })
    );
}

function adaptEpgInfo(
    legacy: StalkerLegacyRequestParameters
): StalkerAdaptedRequest {
    assertOnlyParameters(legacy, [
        'action',
        'from_timestamp',
        'JsHttpRequest',
        'period',
        'to_timestamp',
        'type',
    ]);
    assertJsHttpRequest(legacy);
    assertExactValue(legacy['type'], 'itv');
    return adapted(
        STALKER_SESSION_APPLICATION_OPERATIONS.EpgInfo,
        compact({
            fromTimestamp: optionalNonNegativeInteger(legacy['from_timestamp']),
            periodHours: optionalPositiveInteger(legacy['period']),
            toTimestamp: optionalNonNegativeInteger(legacy['to_timestamp']),
        })
    );
}

function adaptCreateLink(
    legacy: StalkerLegacyRequestParameters
): StalkerAdaptedRequest {
    assertOnlyParameters(legacy, [
        'action',
        'cmd',
        'disable_ad',
        'download',
        'item_id',
        'JsHttpRequest',
        'movie_id',
        'season_number',
        'series',
        'series_id',
        'type',
    ]);
    assertJsHttpRequest(legacy);
    assertOptionalExactNonNegativeInteger(legacy['disable_ad'], 0);
    assertOptionalExactNonNegativeInteger(legacy['download'], 0);
    const episodeNumber = optionalPositiveInteger(legacy['series']);
    const contentType =
        episodeNumber === undefined
            ? readContentType(legacy['type'])
            : 'episode';
    return adapted(
        STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
        compact({
            contentType,
            command: readRequiredString(legacy['cmd']),
            itemId: optionalEntityId(legacy['item_id'] ?? legacy['movie_id']),
            seriesId: optionalEntityId(legacy['series_id']),
            seasonNumber: optionalPositiveInteger(legacy['season_number']),
            episodeNumber,
        })
    );
}

function adaptFavorites(
    legacy: StalkerLegacyRequestParameters
): StalkerAdaptedRequest {
    assertOnlyParameters(legacy, ['action', 'favorite', 'item_id', 'type']);
    return adapted(STALKER_SESSION_APPLICATION_OPERATIONS.Favorites, {
        contentType: readContentType(legacy['type']),
        favorite: readBoolean(legacy['favorite']),
        itemId: readEntityId(legacy['item_id']),
    });
}

function adapted<Operation extends StalkerSessionApplicationOperation>(
    operation: Operation,
    parameters: StalkerSessionOperationParameters<Operation>
): Extract<StalkerAdaptedRequest, { operation: Operation }> {
    const validation = validateStalkerApplicationRequest({
        operation,
        parameters: parameters as unknown as Readonly<Record<string, unknown>>,
    });
    if (validation.kind === 'rejected') {
        const suffix =
            validation.field === undefined ? '' : `:${validation.field}`;
        throw adapterError(`${validation.reason}${suffix}`);
    }
    return {
        operation,
        parameters,
    } as Extract<StalkerAdaptedRequest, { operation: Operation }>;
}

function mapCatalogItemToLegacy(item: StalkerSessionCatalogItem) {
    return compact({
        id: item.id,
        actors: item.actors,
        name: item.name,
        title: item.title,
        o_name: item.originalName,
        description: item.description,
        director: item.director,
        cmd: item.command,
        cover: item.posterUrl,
        logo: item.logoUrl,
        screenshot_uri: item.screenshotUrl,
        category_id: item.categoryId,
        tv_genre_id: item.genreId,
        video_id: item.videoId,
        number: item.channelNumber,
        has_files: booleanFlag(item.hasFiles),
        series: item.seriesNumbers,
        year: item.year,
        rating_imdb: item.rating,
        duration: item.durationSeconds,
        is_series: booleanFlag(item.isSeries),
        info: mapCatalogInfoToLegacy(item.info),
    });
}

function mapCatalogInfoToLegacy(
    info: StalkerSessionCatalogInfo | undefined
): Record<string, unknown> | undefined {
    if (info === undefined) {
        return undefined;
    }
    const mapped = compact({
        actors: info.actors,
        description: info.description,
        director: info.director,
        genre: info.genre,
        movie_image: info.movieImage,
        name: info.name,
        o_name: info.originalName,
        releasedate: info.releaseDate,
        rating_imdb: info.ratingImdb,
        rating_kinopoisk: info.ratingKinopoisk,
    });
    return Object.keys(mapped).length === 0 ? undefined : mapped;
}

function assertNoReservedParameters(
    legacy: StalkerLegacyRequestParameters
): void {
    for (const parameter of Object.keys(legacy)) {
        if (parameter === 'action') {
            continue;
        }
        if (parameter === 'JsHttpRequest') {
            if (legacy[parameter] !== JS_HTTP_REQUEST) {
                throw adapterError(`reserved-parameter:${parameter}`);
            }
            continue;
        }
        if (RESERVED_PARAMETERS.has(parameter.toLowerCase())) {
            throw adapterError(`reserved-parameter:${parameter}`);
        }
    }
}

function assertOnlyParameters(
    legacy: StalkerLegacyRequestParameters,
    allowed: readonly string[]
): void {
    const allowedSet = new Set(allowed);
    for (const parameter of Object.keys(legacy)) {
        if (!allowedSet.has(parameter)) {
            throw adapterError(`unsupported-parameter:${parameter}`);
        }
    }
}

function assertJsHttpRequest(legacy: StalkerLegacyRequestParameters): void {
    if (
        legacy['JsHttpRequest'] !== undefined &&
        legacy['JsHttpRequest'] !== JS_HTTP_REQUEST
    ) {
        throw adapterError('reserved-parameter:JsHttpRequest');
    }
}

function readContentType(
    value: unknown,
    allowed: readonly StalkerSessionContentType[] = [
        'itv',
        'radio',
        'series',
        'vod',
    ]
): StalkerSessionContentType {
    if (
        typeof value !== 'string' ||
        !CONTENT_TYPES.has(value as StalkerSessionContentType) ||
        !allowed.includes(value as StalkerSessionContentType)
    ) {
        throw adapterError('invalid-parameters');
    }
    return value as StalkerSessionContentType;
}

function readEntityId(value: unknown): StalkerSessionEntityId {
    const result = optionalEntityId(value);
    if (result === undefined) {
        throw adapterError('invalid-parameters');
    }
    return result;
}

function optionalEntityId(value: unknown): StalkerSessionEntityId | undefined {
    if (typeof value === 'string') {
        return value.trim().length === 0 ? undefined : value;
    }
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

function readRequiredString(value: unknown): string {
    const result = optionalString(value);
    if (result === undefined) {
        throw adapterError('invalid-parameters');
    }
    return result;
}

function optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}

function readBoolean(value: unknown): boolean {
    if (value === 1 || value === '1') {
        return true;
    }
    if (value === 0 || value === '0') {
        return false;
    }
    throw adapterError('invalid-parameters');
}

function optionalPositiveInteger(value: unknown): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const result = readFiniteNumber(value);
    if (!Number.isSafeInteger(result) || result <= 0) {
        throw adapterError('invalid-parameters');
    }
    return result;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const result = readFiniteNumber(value);
    if (!Number.isSafeInteger(result) || result < 0) {
        throw adapterError('invalid-parameters');
    }
    return result;
}

function readFiniteNumber(value: unknown): number {
    const result =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim().length > 0
              ? Number(value)
              : Number.NaN;
    if (!Number.isFinite(result)) {
        throw adapterError('invalid-parameters');
    }
    return result;
}

function assertExactValue(value: unknown, expected: string): void {
    if (value !== expected) {
        throw adapterError('invalid-parameters');
    }
}

function assertExactPositiveInteger(value: unknown, expected: number): void {
    if (optionalPositiveInteger(value) !== expected) {
        throw adapterError('invalid-parameters');
    }
}

function assertOptionalExactNonNegativeInteger(
    value: unknown,
    expected: number
): void {
    if (value !== undefined && optionalNonNegativeInteger(value) !== expected) {
        throw adapterError('invalid-parameters');
    }
}

function booleanFlag(value: boolean | undefined): number | undefined {
    return value === undefined ? undefined : value ? 1 : 0;
}

function operationResult<Operation extends StalkerSessionApplicationOperation>(
    result: StalkerSessionOperationResult<StalkerSessionApplicationOperation>
): StalkerSessionOperationResult<Operation> {
    return result as StalkerSessionOperationResult<Operation>;
}

function compact<T extends object>(value: T): T {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry !== undefined) {
            result[key] = entry;
        }
    }
    return result as T;
}

function adapterError(reason: string): Error {
    return new Error(`stalker-request-adapter-${reason}`);
}
