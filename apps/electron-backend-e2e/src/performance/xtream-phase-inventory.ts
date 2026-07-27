import type { XtreamScenarioId } from './xtream-benchmark-contract';

export const XTREAM_ATTRIBUTION_PHASE = {
    CANCEL_SESSION: 'xtream.cancel-session',
    DESERIALIZE_PLAYLIST: 'deserialize.playlist',
    JSON_TRANSFORM: 'xtream.json.transform',
    NETWORK_TOTAL: 'xtream.network.total',
    NORMALIZE_CATEGORIES: 'normalize.categories',
    NORMALIZE_CONTENT: 'normalize.content',
    NORMALIZE_SEARCH_RANK: 'normalize.search-rank',
    RESPONSE_READY: 'xtream.response.ready',
    SERIALIZE_PLAYLIST: 'serialize.playlist',
    SQLITE_CATEGORIES_READ: 'sqlite.categories.read',
    SQLITE_CATEGORIES_WRITE_TRANSACTIONS:
        'sqlite.categories.write-transactions',
    SQLITE_CONTENT_CATEGORY_MAP_READ: 'sqlite.content.category-map-read',
    SQLITE_CONTENT_READ: 'sqlite.content.read',
    SQLITE_CONTENT_WRITE_TRANSACTIONS: 'sqlite.content.write-transactions',
    SQLITE_GENERIC_READ: 'sqlite.read',
    SQLITE_GENERIC_WRITE: 'sqlite.write',
    SQLITE_PLAYLIST_DELETE_COLLECT_IDS: 'sqlite.playlist-delete.collect-ids',
    SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS:
        'sqlite.playlist-delete.write-transactions',
    SQLITE_SEARCH_QUERY: 'sqlite.search.query',
    SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS:
        'sqlite.xtream-cache-clear.write-transactions',
    SQLITE_XTREAM_DELETE_COLLECT_USER_DATA:
        'sqlite.xtream-delete.collect-user-data',
    SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS:
        'sqlite.xtream-delete.write-transactions',
    STORE_DELETE_ROW: 'store.xtream-delete-row',
    STORE_IMPORT_TERMINAL: 'store.xtream-import-terminal',
    STORE_PUBLISH_CATEGORIES: 'store.xtream-publish-categories',
    STORE_PUBLISH_LIVE: 'store.xtream-publish-live',
    STORE_PUBLISH_SERIES: 'store.xtream-publish-series',
    STORE_PUBLISH_VOD: 'store.xtream-publish-vod',
    STORE_REFRESH_META: 'store.xtream-refresh-meta',
    STORE_SEARCH_RESULTS: 'store.xtream-search-results',
} as const;

export const XTREAM_PHASE_SEMANTIC_TYPE = {
    ACCOUNT: 'account',
    LIVE_CATEGORIES: 'live-categories',
    LIVE_CONTENT: 'live-content',
    SERIES_CATEGORIES: 'series-categories',
    SERIES_CONTENT: 'series-content',
    VOD_CATEGORIES: 'vod-categories',
    VOD_CONTENT: 'vod-content',
} as const;

export type XtreamPhaseSemanticType =
    (typeof XTREAM_PHASE_SEMANTIC_TYPE)[keyof typeof XTREAM_PHASE_SEMANTIC_TYPE];

export interface XtreamInventoryExpectation {
    readonly itemCounts?: readonly (number | null)[];
    readonly occurrences: number;
}

export interface XtreamIpcOutcomeCounts {
    readonly error: number;
    readonly success: number;
}

type AddExpectation = (
    phase: string,
    occurrences: number,
    itemCounts?: readonly (number | null)[]
) => void;

const PHASE = XTREAM_ATTRIBUTION_PHASE;

export const XTREAM_NORMALIZATION_PHASES = new Set<string>([
    PHASE.NORMALIZE_CATEGORIES,
    PHASE.NORMALIZE_CONTENT,
    PHASE.NORMALIZE_SEARCH_RANK,
]);
export const XTREAM_SQLITE_READ_PHASES = new Set<string>([
    PHASE.SQLITE_CATEGORIES_READ,
    PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
    PHASE.SQLITE_CONTENT_READ,
    PHASE.SQLITE_GENERIC_READ,
    PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
    PHASE.SQLITE_SEARCH_QUERY,
    PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
]);
export const XTREAM_SQLITE_WRITE_PHASES = new Set<string>([
    PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
    PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
    PHASE.SQLITE_GENERIC_WRITE,
    PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
    PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
    PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
]);

export function matchesXtreamPhaseItemCounts(
    phase: string,
    actual: readonly (number | null)[],
    expected: readonly (number | null)[]
): boolean {
    const categories = new Set<string>([
        PHASE.NORMALIZE_CATEGORIES,
        PHASE.SQLITE_CATEGORIES_READ,
        PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
    ]);
    if (!categories.has(phase)) {
        return actual.every((value, index) => value === expected[index]);
    }
    const ordered = (values: readonly (number | null)[]) =>
        [...values].sort(
            (left, right) =>
                (left === null ? -1 : left) - (right === null ? -1 : right)
        );
    return (
        actual.length === expected.length &&
        ordered(actual).every(
            (value, index) => value === ordered(expected)[index]
        )
    );
}

export function expectedXtreamPhases(
    scenarioId: XtreamScenarioId
): ReadonlyMap<string, XtreamInventoryExpectation> {
    const result = new Map<string, XtreamInventoryExpectation>();
    const add: AddExpectation = (phase, occurrences, itemCounts) =>
        result.set(phase, {
            occurrences,
            ...(itemCounts ? { itemCounts } : {}),
        });
    const provider =
        scenarioId === 'xtream-delete-large'
            ? 0
            : scenarioId === 'xtream-cancel-import'
              ? 5
              : 7;
    for (const phase of [
        PHASE.NETWORK_TOTAL,
        PHASE.JSON_TRANSFORM,
        PHASE.RESPONSE_READY,
    ]) {
        add(phase, provider);
    }
    if (scenarioId === 'xtream-delete-large') {
        add(PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS, 2, [100_100, 0]);
        add(PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS, 2, [100_101, 1]);
        add(PHASE.STORE_DELETE_ROW, 1, [1]);
        return result;
    }
    add(PHASE.SERIALIZE_PLAYLIST, 1);
    add(PHASE.SQLITE_GENERIC_WRITE, 1);
    const playlistReads =
        scenarioId === 'xtream-refresh-large' ||
        scenarioId === 'xtream-background-ui'
            ? 2
            : 1;
    add(PHASE.SQLITE_GENERIC_READ, playlistReads);
    add(PHASE.DESERIALIZE_PLAYLIST, playlistReads);
    addFullCategories(add);
    if (scenarioId === 'xtream-cancel-import') {
        add(PHASE.CANCEL_SESSION, 1);
        add(PHASE.SQLITE_CONTENT_READ, 1, [0]);
        add(PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ, 1, [60]);
        add(PHASE.NORMALIZE_CONTENT, 1, [60_000]);
        add(PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS, 1, [null]);
        add(PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS, 3);
        add(PHASE.STORE_PUBLISH_CATEGORIES, 1, [100]);
        add(PHASE.STORE_IMPORT_TERMINAL, 1, [0]);
        return result;
    }
    if (
        scenarioId === 'xtream-refresh-large' ||
        scenarioId === 'xtream-background-ui'
    ) {
        add(PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA, 1, [100_100]);
        add(PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS, 1, [100_100]);
        add(PHASE.STORE_REFRESH_META, 1, [1]);
    }
    addFullContent(add);
    add(PHASE.STORE_PUBLISH_CATEGORIES, 1, [100]);
    add(PHASE.STORE_PUBLISH_LIVE, 1, [60_000]);
    add(PHASE.STORE_PUBLISH_VOD, 1, [20_000]);
    add(PHASE.STORE_PUBLISH_SERIES, 1, [20_000]);
    add(PHASE.STORE_IMPORT_TERMINAL, 1, [100_000]);
    return result;
}

export function expectedXtreamIpc(
    scenarioId: XtreamScenarioId
): ReadonlyMap<string, XtreamIpcOutcomeCounts> {
    const counts =
        scenarioId === 'xtream-delete-large'
            ? { dbDeletePlaylist: 2 }
            : scenarioId === 'xtream-cancel-import'
              ? {
                    dbCancelOperation: 1,
                    dbGetAppPlaylist: 1,
                    dbGetCategories: 6,
                    dbGetContent: 1,
                    dbSaveCategories: 3,
                    dbSaveContent: -1,
                    dbUpsertAppPlaylist: 1,
                    xtreamCancelSession: 1,
                    xtreamRequest: 5,
                }
              : scenarioId === 'xtream-refresh-large' ||
                  scenarioId === 'xtream-background-ui'
                ? {
                      dbDeleteXtreamContent: 1,
                      dbGetAppPlaylist: 2,
                      dbGetCategories: 6,
                      dbGetContent: 6,
                      dbRestoreXtreamUserData: 1,
                      dbSaveCategories: 3,
                      dbSaveContent: 3,
                      dbUpsertAppPlaylist: 1,
                      xtreamRequest: 7,
                  }
                : {
                      dbGetAppPlaylist: 1,
                      dbGetCategories: 6,
                      dbGetContent: 6,
                      dbSaveCategories: 3,
                      dbSaveContent: 3,
                      dbUpsertAppPlaylist: 1,
                      xtreamRequest: 7,
                  };
    return new Map(
        Object.entries(counts).map(([method, count]) => [
            method,
            { error: count < 0 ? -count : 0, success: Math.max(0, count) },
        ])
    );
}

function addFullCategories(add: AddExpectation): void {
    add(PHASE.SQLITE_CATEGORIES_READ, 6, [0, 0, 0, 60, 20, 20]);
    add(PHASE.NORMALIZE_CATEGORIES, 3, [60, 20, 20]);
    add(PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS, 3, [60, 20, 20]);
}

function addFullContent(add: AddExpectation): void {
    add(PHASE.SQLITE_CONTENT_READ, 6, [0, 60_000, 0, 20_000, 0, 20_000]);
    add(PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ, 3, [60, 20, 20]);
    add(PHASE.NORMALIZE_CONTENT, 3, [60_000, 20_000, 20_000]);
    add(PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS, 3, [60_000, 20_000, 20_000]);
}
