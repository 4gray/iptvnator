import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    type StalkerSessionApplicationOperation,
    type StalkerSessionCatalogInfo,
    type StalkerSessionCatalogItem,
    type StalkerSessionCatalogResult,
    type StalkerSessionCategoriesResult,
    type StalkerSessionContentType,
    type StalkerSessionCreateLinkResult,
    type StalkerSessionEntityId,
    type StalkerSessionEpisodesResult,
    type StalkerSessionEpgProgram,
    type StalkerSessionEpgResult,
    type StalkerSessionMainInfoResult,
    type StalkerSessionOperationParameters,
    type StalkerSessionOperationResult,
    type StalkerSessionSeasonsResult,
} from '@iptvnator/shared/interfaces';

export interface StalkerRemoteOperation<
    Operation extends StalkerSessionApplicationOperation,
> {
    readonly kind: 'remote';
    readonly parameters: Readonly<Record<string, string | number>>;
    readonly mapResult: (
        value: unknown
    ) => StalkerSessionOperationResult<Operation>;
}

export interface StalkerLocalOperation<
    Operation extends StalkerSessionApplicationOperation,
> {
    readonly kind: 'local';
    readonly result: StalkerSessionOperationResult<Operation>;
}

export type StalkerMappedOperation<
    Operation extends StalkerSessionApplicationOperation,
> = StalkerRemoteOperation<Operation> | StalkerLocalOperation<Operation>;

const JS_HTTP_REQUEST = '1-xml';
const SEARCH_PAGE_SIZE = 100;

export function mapRawOperation<
    Operation extends StalkerSessionApplicationOperation,
>(
    operation: Operation,
    parameters: StalkerSessionOperationParameters<Operation>
): StalkerMappedOperation<Operation> {
    switch (operation) {
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories:
            return remote(
                {
                    action: 'get_categories',
                    JsHttpRequest: JS_HTTP_REQUEST,
                    type: readContentType(
                        readRecord(parameters)['contentType'],
                        ['radio', 'series', 'vod']
                    ),
                },
                mapCategories
            );
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogGenres:
            assertEmptyParameters(parameters);
            return remote(
                {
                    action: 'get_genres',
                    JsHttpRequest: JS_HTTP_REQUEST,
                    type: 'itv',
                },
                mapCategories
            );
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems:
            return mapCatalogItems(parameters);
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogAllChannels:
            assertEmptyParameters(parameters);
            return remote(
                {
                    action: 'get_all_channels',
                    JsHttpRequest: JS_HTTP_REQUEST,
                    type: 'itv',
                },
                (value) => mapCatalog(value, 'itv')
            );
        case STALKER_SESSION_APPLICATION_OPERATIONS.CatalogSearch:
            return mapSearch(parameters);
        case STALKER_SESSION_APPLICATION_OPERATIONS.SeriesSeasons:
            return mapSeasons(parameters);
        case STALKER_SESSION_APPLICATION_OPERATIONS.SeriesEpisodes:
            return mapEpisodes(parameters);
        case STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg:
            return mapShortEpg(parameters);
        case STALKER_SESSION_APPLICATION_OPERATIONS.EpgInfo:
            return mapEpgInfo(parameters);
        case STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink:
            return mapCreateLink(parameters);
        case STALKER_SESSION_APPLICATION_OPERATIONS.Favorites: {
            const record = readRecord(parameters);
            const favorite = readBoolean(record['favorite']);
            readEntityId(record['itemId']);
            readContentType(record['contentType']);
            return {
                kind: 'local',
                result: {
                    favorite,
                    success: true,
                },
            } as StalkerMappedOperation<Operation>;
        }
        case STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo:
            assertEmptyParameters(parameters);
            return remote(
                {
                    action: 'get_main_info',
                    JsHttpRequest: JS_HTTP_REQUEST,
                    type: 'account_info',
                },
                mapMainInfo
            );
        default:
            return assertNever(operation);
    }
}

function mapCatalogItems<Operation extends StalkerSessionApplicationOperation>(
    parameters: StalkerSessionOperationParameters<Operation>
): StalkerMappedOperation<Operation> {
    const record = readRecord(parameters);
    const contentType = readPortalContentType(record['contentType']);
    const wire: Record<string, string | number> = {
        action: 'get_ordered_list',
        JsHttpRequest: JS_HTTP_REQUEST,
        type: contentType,
    };
    copyEntityId(record, 'category', wire, 'category');
    copyEntityId(record, 'genre', wire, 'genre');
    copyPositiveInteger(record, 'page', wire, 'p');
    copyTrimmedString(record, 'query', wire, 'search');
    copyTrimmedString(record, 'sortBy', wire, 'sortby');
    copyEntityId(record, 'itemId', wire, 'movie_id');
    copyEntityId(record, 'seasonId', wire, 'season_id');
    return remote(wire, (value) => mapCatalog(value, contentType));
}

function mapSearch<Operation extends StalkerSessionApplicationOperation>(
    parameters: StalkerSessionOperationParameters<Operation>
): StalkerMappedOperation<Operation> {
    const record = readRecord(parameters);
    const contentType = readPortalContentType(record['contentType']);
    const query = readRequiredString(record['query']);
    const wire: Record<string, string | number> = {
        action: 'get_ordered_list',
        JsHttpRequest: JS_HTTP_REQUEST,
        max_page_items: SEARCH_PAGE_SIZE,
        search: query,
        type: contentType,
    };
    copyEntityId(record, 'category', wire, 'category');
    copyPositiveInteger(record, 'page', wire, 'p');
    return remote(wire, (value) => mapCatalog(value, contentType));
}

function mapSeasons<Operation extends StalkerSessionApplicationOperation>(
    parameters: StalkerSessionOperationParameters<Operation>
): StalkerMappedOperation<Operation> {
    const seriesId = readEntityId(readRecord(parameters)['seriesId']);
    return remote(
        {
            action: 'get_ordered_list',
            JsHttpRequest: JS_HTTP_REQUEST,
            movie_id: seriesId,
            type: 'series',
        },
        mapSeasonResult
    );
}

function mapEpisodes<Operation extends StalkerSessionApplicationOperation>(
    parameters: StalkerSessionOperationParameters<Operation>
): StalkerMappedOperation<Operation> {
    const record = readRecord(parameters);
    const seriesId = readEntityId(record['seriesId']);
    const seasonId = readEntityId(record['seasonId']);
    return remote(
        {
            action: 'get_ordered_list',
            JsHttpRequest: JS_HTTP_REQUEST,
            movie_id: seriesId,
            p: 1,
            season_id: seasonId,
            type: 'vod',
        },
        (value) => mapEpisodeResult(value, seriesId, seasonId)
    );
}

function mapShortEpg<Operation extends StalkerSessionApplicationOperation>(
    parameters: StalkerSessionOperationParameters<Operation>
): StalkerMappedOperation<Operation> {
    const record = readRecord(parameters);
    const channelId = readEntityId(record['channelId']);
    const wire: Record<string, string | number> = {
        action: 'get_short_epg',
        ch_id: channelId,
        JsHttpRequest: JS_HTTP_REQUEST,
        type: 'itv',
    };
    copyPositiveInteger(record, 'limit', wire, 'size');
    return remote(wire, (value) => mapEpg(value, channelId));
}

function mapEpgInfo<Operation extends StalkerSessionApplicationOperation>(
    parameters: StalkerSessionOperationParameters<Operation>
): StalkerMappedOperation<Operation> {
    const record = readRecord(parameters);
    const wire: Record<string, string | number> = {
        action: 'get_epg_info',
        JsHttpRequest: JS_HTTP_REQUEST,
        type: 'itv',
    };
    copyNonNegativeInteger(record, 'fromTimestamp', wire, 'from_timestamp');
    copyPositiveInteger(record, 'periodHours', wire, 'period');
    copyNonNegativeInteger(record, 'toTimestamp', wire, 'to_timestamp');
    return remote(wire, (value) => mapEpg(value));
}

function mapCreateLink<Operation extends StalkerSessionApplicationOperation>(
    parameters: StalkerSessionOperationParameters<Operation>
): StalkerMappedOperation<Operation> {
    const record = readRecord(parameters);
    const contentType = readContentType(record['contentType'], [
        'episode',
        'itv',
        'radio',
        'series',
        'vod',
    ]);
    const command = readRequiredString(record['command']);
    const wire: Record<string, string | number> = {
        action: 'create_link',
        cmd: command,
        disable_ad: 0,
        download: 0,
        JsHttpRequest: JS_HTTP_REQUEST,
        type: contentType === 'episode' ? 'vod' : contentType,
    };
    if (contentType === 'episode') {
        wire['series'] = readPositiveInteger(record['episodeNumber']);
    }
    return remote(wire, mapCreateLinkResult);
}

function mapCategories(value: unknown): StalkerSessionCategoriesResult {
    const items = readArray(unwrapJs(value)).flatMap((value) => {
        const record = asRecord(value);
        if (!record) {
            return [];
        }
        const id = optionalEntityId(record['id']);
        const name =
            optionalString(record['title']) ?? optionalString(record['name']);
        if (id === undefined || name === undefined) {
            return [];
        }
        const alias = optionalString(record['alias']);
        const parentId = optionalEntityId(
            record['parent_id'] ?? record['parentId']
        );
        const censored = optionalBoolean(record['censored']);
        return [
            compact({
                id,
                name,
                alias,
                censored,
                parentId,
            }),
        ];
    });
    return { items };
}

function mapCatalog(
    value: unknown,
    contentType: StalkerSessionContentType
): StalkerSessionCatalogResult {
    const js = unwrapJs(value);
    const envelope = asRecord(js);
    const rawItems = envelope ? readArray(envelope['data']) : readArray(js);
    const items = rawItems.flatMap((value) => {
        const mapped = mapCatalogItem(value, contentType);
        return mapped ? [mapped] : [];
    });
    if (!envelope) {
        return { items };
    }

    const page = optionalPositiveInteger(
        envelope['cur_page'] ?? envelope['page']
    );
    const total = optionalNonNegativeInteger(envelope['total_items']);
    const pageSize = optionalPositiveInteger(envelope['max_page_items']);
    const hasMore =
        total !== undefined && page !== undefined
            ? pageSize !== undefined
                ? page * pageSize < total
                : items.length > 0 && page * items.length < total
            : undefined;
    return compact({ hasMore, items, page, total });
}

function mapCatalogItem(
    value: unknown,
    contentType: StalkerSessionContentType
): StalkerSessionCatalogItem | undefined {
    const record = asRecord(value);
    if (!record) {
        return undefined;
    }
    const id = optionalEntityId(
        record['id'] ??
            record['stream_id'] ??
            record['movie_id'] ??
            record['series_id']
    );
    if (id === undefined) {
        return undefined;
    }
    const rating = optionalFiniteNumber(
        record['rating_imdb'] ?? record['rating']
    );
    const info = mapCatalogInfo(record['info']);
    return compact({
        id,
        contentType,
        actors: optionalString(record['actors']),
        categoryId: optionalEntityId(record['category_id']),
        channelNumber: optionalNonNegativeInteger(record['number']),
        command: optionalString(record['cmd']),
        description: optionalString(record['description']),
        director: optionalString(record['director']),
        durationSeconds: optionalNonNegativeInteger(
            record['duration'] ?? record['duration_seconds']
        ),
        genreId: optionalEntityId(record['tv_genre_id'] ?? record['genre_id']),
        hasFiles: optionalBoolean(record['has_files']),
        info,
        isSeries: optionalBoolean(record['is_series']),
        logoUrl: optionalString(record['logo']),
        name: optionalString(record['name']),
        originalName: optionalString(record['o_name']),
        posterUrl: optionalString(record['cover'] ?? record['movie_image']),
        rating,
        screenshotUrl: optionalString(record['screenshot_uri']),
        seriesNumbers: readNumberArray(record['series']),
        title: optionalString(record['title']),
        videoId: optionalEntityId(record['video_id']),
        year: optionalNonNegativeInteger(record['year']),
    });
}

function mapCatalogInfo(value: unknown): StalkerSessionCatalogInfo | undefined {
    const record = asRecord(value);
    if (!record) {
        return undefined;
    }
    const info = compact({
        actors: optionalString(record['actors']),
        description: optionalString(record['description']),
        director: optionalString(record['director']),
        genre: optionalString(record['genre']),
        movieImage: optionalString(record['movie_image']),
        name: optionalString(record['name']),
        originalName: optionalString(record['o_name']),
        releaseDate: optionalString(record['releasedate']),
        ratingImdb: optionalString(record['rating_imdb']),
        ratingKinopoisk: optionalString(record['rating_kinopoisk']),
    });
    return Object.keys(info).length > 0 ? info : undefined;
}

function mapSeasonResult(value: unknown): StalkerSessionSeasonsResult {
    const seasons = readDataArray(value).flatMap((value, index) => {
        const record = asRecord(value);
        if (!record) {
            return [];
        }
        const id = optionalEntityId(record['id']);
        if (id === undefined) {
            return [];
        }
        const number =
            optionalPositiveInteger(
                record['season_number'] ?? record['number']
            ) ??
            readIdSuffixNumber(id) ??
            index + 1;
        return [
            compact({
                id,
                number,
                command: optionalString(record['cmd']),
                episodeNumbers: readNumberArray(record['series']),
                title:
                    optionalString(record['name']) ??
                    optionalString(record['title']),
            }),
        ];
    });
    return { seasons };
}

function mapEpisodeResult(
    value: unknown,
    seriesId: StalkerSessionEntityId,
    seasonId: StalkerSessionEntityId
): StalkerSessionEpisodesResult {
    const seasonNumber = readIdSuffixNumber(seasonId) ?? 1;
    const episodes = readDataArray(value).flatMap((value, index) => {
        const record = asRecord(value);
        if (!record) {
            return [];
        }
        const id = optionalEntityId(record['id']);
        if (id === undefined) {
            return [];
        }
        const episodeNumber =
            optionalPositiveInteger(
                record['episode_num'] ?? record['series_number']
            ) ?? index + 1;
        return [
            compact({
                id,
                episodeNumber,
                seasonId,
                seasonNumber,
                seriesId,
                command: optionalString(record['cmd']),
                description: optionalString(record['description']),
                durationSeconds: optionalNonNegativeInteger(record['duration']),
                thumbnailUrl: optionalString(
                    record['cover'] ?? record['screenshot_uri']
                ),
                title:
                    optionalString(record['name']) ??
                    optionalString(record['title']),
            }),
        ];
    });
    return { episodes };
}

function mapEpg(
    value: unknown,
    fallbackChannelId?: StalkerSessionEntityId
): StalkerSessionEpgResult {
    const programs = flattenEpgEntries(unwrapJs(value)).flatMap((value) => {
        const record = asRecord(value);
        if (!record) {
            return [];
        }
        const channelId =
            optionalEntityId(record['ch_id'] ?? record['channel_id']) ??
            fallbackChannelId;
        const title =
            optionalString(record['name']) ?? optionalString(record['title']);
        const startsAt = optionalTimestamp(
            record['start_timestamp'] ?? record['start'] ?? record['time']
        );
        const endsAt = optionalTimestamp(
            record['stop_timestamp'] ?? record['stop'] ?? record['time_to']
        );
        if (
            channelId === undefined ||
            title === undefined ||
            startsAt === undefined ||
            endsAt === undefined
        ) {
            return [];
        }
        return [
            compact<StalkerSessionEpgProgram>({
                channelId,
                endsAt,
                startsAt,
                title,
                description: optionalString(
                    record['descr'] ?? record['description']
                ),
                id: optionalEntityId(record['id']),
            }),
        ];
    });
    return { programs };
}

function mapCreateLinkResult(value: unknown): StalkerSessionCreateLinkResult {
    const record = asRecord(unwrapJs(value));
    const streamUrl = normalizePlaybackCommand(
        optionalString(record?.['cmd']) ?? ''
    );
    if (!streamUrl) {
        throw invalidResponse();
    }
    return { streamUrl };
}

function mapMainInfo(value: unknown): StalkerSessionMainInfoResult {
    const js = asRecord(unwrapJs(value));
    const account = asRecord(js?.['account_info']) ?? js;
    if (!account) {
        throw invalidResponse();
    }
    return {
        account: compact({
            accountBalance: optionalString(account['account_balance']),
            expiresAt: optionalString(account['expire_date']),
            name:
                optionalString(account['login']) ??
                optionalString(account['name']),
            status: optionalString(account['status']),
            tariffPlan: optionalString(account['tariff_plan_name']),
        }),
    };
}

function remote<Operation extends StalkerSessionApplicationOperation>(
    parameters: Readonly<Record<string, string | number>>,
    mapResult: (value: unknown) => StalkerSessionOperationResult<Operation>
): StalkerMappedOperation<Operation> {
    return {
        kind: 'remote',
        mapResult,
        parameters,
    };
}

function unwrapJs(value: unknown): unknown {
    const record = asRecord(value);
    return record && Object.prototype.hasOwnProperty.call(record, 'js')
        ? record['js']
        : value;
}

function readDataArray(value: unknown): readonly unknown[] {
    const js = unwrapJs(value);
    const record = asRecord(js);
    return record ? readArray(record['data']) : readArray(js);
}

function flattenEpgEntries(value: unknown): readonly unknown[] {
    if (Array.isArray(value)) {
        return value;
    }
    const record = asRecord(value);
    if (!record) {
        return [];
    }
    const direct = readArray(record['data']);
    if (direct.length > 0) {
        return direct;
    }
    const result: unknown[] = [];
    for (const nested of Object.values(record)) {
        if (Array.isArray(nested)) {
            result.push(...nested);
            continue;
        }
        const nestedRecord = asRecord(nested);
        if (nestedRecord) {
            result.push(
                ...readArray(
                    nestedRecord['data'] ??
                        nestedRecord['epg'] ??
                        nestedRecord['items']
                )
            );
        }
    }
    return result;
}

function normalizePlaybackCommand(value: string): string {
    const trimmed = value.trim();
    const separator = trimmed.indexOf(' ');
    if (separator > 0) {
        const candidate = trimmed.slice(separator + 1).trim();
        if (
            candidate.startsWith('http://') ||
            candidate.startsWith('https://') ||
            candidate.startsWith('/') ||
            candidate.startsWith('?')
        ) {
            return candidate;
        }
    }
    return trimmed;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
    const record = asRecord(value);
    if (!record) {
        throw invalidParameters();
    }
    return record;
}

function asRecord(
    value: unknown
): Readonly<Record<string, unknown>> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : undefined;
}

function readArray(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? value : [];
}

function readRequiredString(value: unknown): string {
    const result = optionalString(value);
    if (result === undefined) {
        throw invalidParameters();
    }
    return result;
}

function optionalString(value: unknown): string | undefined {
    if (
        (typeof value !== 'string' &&
            typeof value !== 'number' &&
            typeof value !== 'boolean') ||
        String(value).trim() === ''
    ) {
        return undefined;
    }
    return String(value).trim();
}

function readEntityId(value: unknown): StalkerSessionEntityId {
    const result = optionalEntityId(value);
    if (result === undefined) {
        throw invalidParameters();
    }
    return result;
}

function optionalEntityId(value: unknown): StalkerSessionEntityId | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    return typeof value === 'string' && value.trim() !== ''
        ? value.trim()
        : undefined;
}

function readContentType(
    value: unknown,
    allowed: readonly string[] = ['itv', 'radio', 'series', 'vod']
): StalkerSessionContentType | 'episode' {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw invalidParameters();
    }
    return value as StalkerSessionContentType | 'episode';
}

function readPortalContentType(value: unknown): StalkerSessionContentType {
    return readContentType(value) as StalkerSessionContentType;
}

function readBoolean(value: unknown): boolean {
    const result = optionalBoolean(value);
    if (result === undefined) {
        throw invalidParameters();
    }
    return result;
}

function optionalBoolean(value: unknown): boolean | undefined {
    if (value === true || value === 1 || value === '1') {
        return true;
    }
    if (value === false || value === 0 || value === '0') {
        return false;
    }
    return undefined;
}

function readPositiveInteger(value: unknown): number {
    const result = optionalPositiveInteger(value);
    if (result === undefined) {
        throw invalidParameters();
    }
    return result;
}

function optionalPositiveInteger(value: unknown): number | undefined {
    const result = optionalFiniteNumber(value);
    return result !== undefined && Number.isSafeInteger(result) && result > 0
        ? result
        : undefined;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
    const result = optionalFiniteNumber(value);
    return result !== undefined && Number.isSafeInteger(result) && result >= 0
        ? result
        : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
    if (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '')
    ) {
        return undefined;
    }
    const result = Number(value);
    return Number.isFinite(result) ? result : undefined;
}

function optionalTimestamp(value: unknown): number | undefined {
    const numeric = optionalFiniteNumber(value);
    if (numeric !== undefined && numeric >= 0) {
        return numeric;
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}

function readNumberArray(value: unknown): readonly number[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const numbers = value.flatMap((entry) => {
        const number = optionalPositiveInteger(entry);
        return number === undefined ? [] : [number];
    });
    return numbers.length > 0 ? numbers : undefined;
}

function readIdSuffixNumber(value: StalkerSessionEntityId): number | undefined {
    const suffix = String(value).split(':').at(-1);
    return optionalPositiveInteger(suffix);
}

function copyEntityId(
    source: Readonly<Record<string, unknown>>,
    sourceKey: string,
    target: Record<string, string | number>,
    targetKey: string
): void {
    const value = source[sourceKey];
    if (value !== undefined) {
        target[targetKey] = readEntityId(value);
    }
}

function copyPositiveInteger(
    source: Readonly<Record<string, unknown>>,
    sourceKey: string,
    target: Record<string, string | number>,
    targetKey: string
): void {
    const value = source[sourceKey];
    if (value !== undefined) {
        target[targetKey] = readPositiveInteger(value);
    }
}

function copyNonNegativeInteger(
    source: Readonly<Record<string, unknown>>,
    sourceKey: string,
    target: Record<string, string | number>,
    targetKey: string
): void {
    const value = source[sourceKey];
    if (value === undefined) {
        return;
    }
    const parsed = optionalNonNegativeInteger(value);
    if (parsed === undefined) {
        throw invalidParameters();
    }
    target[targetKey] = parsed;
}

function copyTrimmedString(
    source: Readonly<Record<string, unknown>>,
    sourceKey: string,
    target: Record<string, string | number>,
    targetKey: string
): void {
    const value = source[sourceKey];
    if (value !== undefined) {
        target[targetKey] = readRequiredString(value);
    }
}

function assertEmptyParameters(value: unknown): void {
    if (Object.keys(readRecord(value)).length !== 0) {
        throw invalidParameters();
    }
}

function compact<T extends object>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined)
    ) as T;
}

function invalidParameters(): Error {
    return new Error('stalker-operation-invalid-parameters');
}

function invalidResponse(): Error {
    return new Error('stalker-operation-invalid-response');
}

function assertNever(value: never): never {
    throw new Error(`stalker-operation-unsupported:${String(value)}`);
}
