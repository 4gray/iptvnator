import {
    XTREAM_ATTRIBUTION_PHASE as PHASE,
    type XtreamAttributionPhaseEvent,
    type XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';
import {
    createXtreamFixtureInventoryBuilder as createInventoryBuilder,
    createXtreamFixtureIpcInventory as ipcInventory,
    type XtreamFixtureInventoryBuilder as InventoryBuilder,
} from './xtream-phase-attribution-fixture-builder';
import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { XTREAM_PHASE_SEMANTIC_TYPE as SEMANTIC } from './xtream-phase-inventory';

export { pair } from './xtream-phase-attribution-fixture-builder';

const CATEGORY_COUNTS = [60, 20, 20] as const;
const CONTENT_COUNTS = [60_000, 20_000, 20_000] as const;
const CATEGORY_SEMANTICS = [
    SEMANTIC.LIVE_CATEGORIES,
    SEMANTIC.VOD_CATEGORIES,
    SEMANTIC.SERIES_CATEGORIES,
] as const;
const CONTENT_SEMANTICS = [
    SEMANTIC.LIVE_CONTENT,
    SEMANTIC.VOD_CONTENT,
    SEMANTIC.SERIES_CONTENT,
] as const;

export function scenarioCapture(
    scenarioId: XtreamScenarioId
): XtreamPhaseAttributionInput {
    const builder = createInventoryBuilder();

    if (scenarioId === XTREAM_SCENARIO_ID.DELETE_LARGE) {
        builder.add(
            PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
            'delete-request-1',
            100_100
        );
        builder.add(
            PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
            'delete-request-1',
            100_101
        );
        builder.add(PHASE.STORE_DELETE_ROW, 'delete-store', 1);
        const paint = builder.cursor + 2;
        builder.add(
            PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
            'delete-request-2',
            0
        );
        builder.add(
            PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
            'delete-request-2',
            1
        );
        return builder.capture(
            scenarioId,
            ipcInventory({ dbDeletePlaylist: 2 }),
            paint
        );
    }

    if (
        scenarioId === XTREAM_SCENARIO_ID.REFRESH_LARGE ||
        scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI
    ) {
        builder.add(
            PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
            'refresh-delete',
            100_100
        );
        builder.add(
            PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
            'refresh-delete',
            100_100
        );
        builder.add(PHASE.STORE_REFRESH_META, 'refresh-meta', 1);
        addPlaylistRead(builder, 'refresh-effect');
        addPlaylistUpsert(builder);
        addPlaylistRead(builder, 'workspace-route');
        builder.addProvider('provider-account', SEMANTIC.ACCOUNT);
        addImportFlow(builder);
        return builder.capture(
            scenarioId,
            ipcInventory({
                dbDeleteXtreamContent: 1,
                dbGetAppPlaylist: 2,
                dbGetCategories: 6,
                dbGetContent: 6,
                dbRestoreXtreamUserData: 1,
                dbSaveCategories: 3,
                dbSaveContent: 3,
                dbUpsertAppPlaylist: 1,
                xtreamRequest: 7,
            })
        );
    }

    addPlaylistUpsert(builder);
    addPlaylistRead(builder, 'workspace-route');
    builder.addProvider('provider-account', SEMANTIC.ACCOUNT);
    addCategories(builder);
    if (scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT) {
        builder.add(PHASE.STORE_PUBLISH_CATEGORIES, 'store-categories', 100);
        builder.add(
            PHASE.SQLITE_CONTENT_READ,
            'content-read-live-pre',
            0,
            SEMANTIC.LIVE_CONTENT
        );
        builder.addProvider('provider-content-0', SEMANTIC.LIVE_CONTENT);
        builder.add(
            PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
            'content-save-live',
            60,
            SEMANTIC.LIVE_CONTENT
        );
        builder.add(
            PHASE.NORMALIZE_CONTENT,
            'content-save-live',
            60_000,
            SEMANTIC.LIVE_CONTENT
        );
        const liveWriteStart = builder.cursor;
        builder.addAt(
            PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
            'content-save-live',
            liveWriteStart,
            6,
            null,
            SEMANTIC.LIVE_CONTENT
        );
        builder.addAt(
            PHASE.CANCEL_SESSION,
            'cancel-session',
            liveWriteStart + 2,
            1,
            0
        );
        builder.add(
            PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
            'cache-clear-live',
            6_060
        );
        builder.add(
            PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
            'cache-clear-movie',
            20
        );
        builder.add(
            PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
            'cache-clear-series',
            20
        );
        builder.add(PHASE.STORE_IMPORT_TERMINAL, 'store-terminal', 0);
        return builder.capture(
            scenarioId,
            ipcInventory({
                dbCancelOperation: 1,
                dbGetAppPlaylist: 1,
                dbGetCategories: 6,
                dbGetContent: 1,
                dbSaveCategories: 3,
                dbSaveContent: -1,
                dbUpsertAppPlaylist: 1,
                xtreamCancelSession: 1,
                xtreamRequest: 5,
            })
        );
    }

    builder.add(PHASE.STORE_PUBLISH_CATEGORIES, 'store-categories', 100);
    addContentAndStores(builder);
    return builder.capture(
        scenarioId,
        ipcInventory({
            dbGetAppPlaylist: 1,
            dbGetCategories: 6,
            dbGetContent: 6,
            dbSaveCategories: 3,
            dbSaveContent: 3,
            dbUpsertAppPlaylist: 1,
            xtreamRequest: 7,
        })
    );
}

function addImportFlow(builder: InventoryBuilder): void {
    addCategories(builder);
    builder.add(PHASE.STORE_PUBLISH_CATEGORIES, 'store-categories', 100);
    addContentAndStores(builder);
}

function addPlaylistRead(builder: InventoryBuilder, id: string): void {
    const requestId = `playlist-get-${id}`;
    builder.add(PHASE.SQLITE_GENERIC_READ, requestId, 1);
    builder.add(PHASE.DESERIALIZE_PLAYLIST, requestId, 1);
}

function addPlaylistUpsert(builder: InventoryBuilder): void {
    builder.add(PHASE.SERIALIZE_PLAYLIST, 'playlist-upsert', 1);
    builder.add(PHASE.SQLITE_GENERIC_WRITE, 'playlist-upsert', 1);
}

function addCategories(builder: InventoryBuilder): void {
    CATEGORY_COUNTS.forEach((_count, index) => {
        builder.add(
            PHASE.SQLITE_CATEGORIES_READ,
            `category-read-${index}-pre`,
            0,
            CATEGORY_SEMANTICS[index]
        );
    });
    CATEGORY_COUNTS.forEach((_count, index) => {
        builder.addProvider(
            `provider-category-${index}`,
            CATEGORY_SEMANTICS[index]
        );
    });
    CATEGORY_COUNTS.forEach((count, index) => {
        builder.add(
            PHASE.NORMALIZE_CATEGORIES,
            `category-save-${index}`,
            count,
            CATEGORY_SEMANTICS[index]
        );
        builder.add(
            PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
            `category-save-${index}`,
            count,
            CATEGORY_SEMANTICS[index]
        );
        builder.add(
            PHASE.SQLITE_CATEGORIES_READ,
            `category-read-${index}-post`,
            count,
            CATEGORY_SEMANTICS[index]
        );
    });
}

function addContentAndStores(builder: InventoryBuilder): void {
    const storePhases = [
        PHASE.STORE_PUBLISH_LIVE,
        PHASE.STORE_PUBLISH_VOD,
        PHASE.STORE_PUBLISH_SERIES,
    ] as const;
    const storeIds = ['store-live', 'store-vod', 'store-series'] as const;
    CONTENT_COUNTS.forEach((count, index) => {
        builder.add(
            PHASE.SQLITE_CONTENT_READ,
            `content-read-${index}-pre`,
            0,
            CONTENT_SEMANTICS[index]
        );
        builder.addProvider(
            `provider-content-${index}`,
            CONTENT_SEMANTICS[index]
        );
        builder.add(
            PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
            `content-save-${index}`,
            CATEGORY_COUNTS[index],
            CONTENT_SEMANTICS[index]
        );
        builder.add(
            PHASE.NORMALIZE_CONTENT,
            `content-save-${index}`,
            count,
            CONTENT_SEMANTICS[index]
        );
        builder.add(
            PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
            `content-save-${index}`,
            count,
            CONTENT_SEMANTICS[index]
        );
        builder.add(
            PHASE.SQLITE_CONTENT_READ,
            `content-read-${index}-post`,
            count,
            CONTENT_SEMANTICS[index]
        );
        builder.add(
            storePhases[index],
            storeIds[index],
            count,
            CONTENT_SEMANTICS[index]
        );
    });
    builder.add(PHASE.STORE_IMPORT_TERMINAL, 'store-terminal', 100_000);
}

export function removePair(
    events: readonly XtreamAttributionPhaseEvent[],
    phase: string,
    correlationId: string
): XtreamAttributionPhaseEvent[] {
    return events.filter(
        (event) =>
            event.phase !== phase || event.correlationId !== correlationId
    );
}

export function lastStoreEnd(
    events: readonly XtreamAttributionPhaseEvent[]
): number {
    return Math.max(
        ...events
            .filter(
                (event) =>
                    event.boundary === 'end' && event.phase.startsWith('store.')
            )
            .map((event) => event.epochMs)
    );
}
