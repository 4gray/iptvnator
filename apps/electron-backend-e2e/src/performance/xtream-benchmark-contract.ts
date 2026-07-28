import type { XTREAM_MEMORY_ACCOUNTING } from './xtream-summary-contract';
import type { XtreamBenchmarkBuildIdentity } from './xtream-build-identity';

export const XTREAM_SCENARIO_ID = {
    INITIAL_IMPORT_LARGE: 'xtream-initial-import-large',
    REFRESH_LARGE: 'xtream-refresh-large',
    DELETE_LARGE: 'xtream-delete-large',
    CANCEL_IMPORT: 'xtream-cancel-import',
    BACKGROUND_UI: 'xtream-background-ui',
} as const;

export type XtreamScenarioId =
    (typeof XTREAM_SCENARIO_ID)[keyof typeof XTREAM_SCENARIO_ID];

export const XTREAM_ITERATION_KIND = {
    DIAGNOSTIC: 'diagnostic',
    MEASURED: 'measured',
    WARMUP: 'warmup',
} as const;

export type XtreamIterationKind =
    (typeof XTREAM_ITERATION_KIND)[keyof typeof XTREAM_ITERATION_KIND];

export interface XtreamScenario {
    readonly id: XtreamScenarioId;
}

export interface XtreamWorkerRequestInventoryEntry {
    readonly count: number;
    readonly operation: string;
    readonly phases: readonly string[];
    readonly success: boolean;
}

export interface XtreamIterationDefinition {
    readonly eligibleForComparison: boolean;
    readonly kind: XtreamIterationKind;
    readonly runId: string;
    readonly scenarioId: XtreamScenarioId;
}

export interface XtreamPerformanceManifest {
    readonly bytes: number;
    readonly catalogSha256: string;
    readonly counts: {
        readonly categories: XtreamCatalogCounts;
        readonly items: XtreamCatalogCounts;
    };
    readonly epoch: number;
    readonly scenario: 'performance-100k';
    readonly seed: 91_001;
}

export interface XtreamCatalogCounts {
    readonly live: number;
    readonly series: number;
    readonly total: number;
    readonly vod: number;
}

export interface XtreamOccurrence {
    readonly action: string;
    readonly categoryId: string;
    readonly count: number;
    readonly scenario: string;
    readonly transport: string;
}

export interface XtreamLedgerEntry {
    readonly action: string;
    readonly atMs: number;
    readonly categoryId: string;
    readonly epoch: number;
    readonly occurrence: number;
    readonly scenario: string;
    readonly status: string;
    readonly transport: string;
}

export interface XtreamControlState {
    readonly epoch: number;
    readonly heldCount: number;
    readonly heldIds: readonly string[];
    readonly ledger: readonly XtreamLedgerEntry[];
    readonly occurrences: readonly XtreamOccurrence[];
    readonly prepared: XtreamPerformanceManifest | null;
    readonly rules: readonly unknown[];
}

export interface XtreamBenchmarkManifest {
    readonly build: XtreamBenchmarkBuildIdentity;
    readonly environment: XtreamBenchmarkEnvironment;
    readonly fixture: XtreamBenchmarkFixture;
    readonly memoryAccounting: typeof XTREAM_MEMORY_ACCOUNTING;
    readonly mode: 'formal' | 'smoke';
    readonly runtime: XtreamBenchmarkRuntime;
    readonly source: XtreamBenchmarkSource;
    readonly suite: 'xtream-performance-100k';
    readonly variant: string;
}

export interface XtreamBenchmarkEnvironment {
    readonly cdpAddress: '127.0.0.1';
    readonly cdpPort: number;
    readonly databaseWorkerBatchDelayMs: 0;
    readonly exposeGc: true;
    readonly freshUserDataPerIteration: true;
    readonly perfCapture: '1';
    readonly perfWorkerProfiling: '1';
    readonly traceRendererConsole: '0';
}

export interface XtreamBenchmarkFixture {
    readonly bytes: number;
    readonly catalogSha256: string;
    readonly categories: 100;
    readonly items: 100_000;
    readonly scenario: 'performance-100k';
    readonly seed: 91_001;
}

export interface XtreamBenchmarkRuntime {
    readonly arch: string;
    readonly electronVersion: string;
    readonly harnessNodeVersion: string;
    readonly platform: string;
}

export interface XtreamBenchmarkSource {
    readonly gitCommit: string;
    readonly gitDiffSha256: string;
    readonly gitDirty: boolean;
}

export interface NumericDistribution {
    readonly count: number;
    readonly max: number | null;
    readonly mean: number | null;
    readonly median: number | null;
    readonly min: number | null;
    readonly p95: number | null;
    readonly p99: number | null;
}

export function summarizeXtreamNumbers(
    values: readonly number[]
): NumericDistribution {
    const samples = [...values].sort((left, right) => left - right);
    const total = samples.reduce((sum, value) => sum + value, 0);
    const percentile = (rank: number): number => {
        if (samples.length === 1) return samples[0] ?? 0;
        const position = ((samples.length - 1) * rank) / 100;
        const lowerIndex = Math.floor(position);
        const upperIndex = Math.ceil(position);
        const lower = samples[lowerIndex] ?? 0;
        const upper = samples[upperIndex] ?? lower;
        return lower + (upper - lower) * (position - lowerIndex);
    };
    return {
        count: samples.length,
        max: samples.at(-1) ?? null,
        mean: total / samples.length,
        median: percentile(50),
        min: samples[0] ?? null,
        p95: percentile(95),
        p99: percentile(99),
    };
}

export interface XtreamScenarioMetrics {
    readonly angularRenderingMs: NumericDistribution;
    readonly cancelAcknowledgementLatencyMs: NumericDistribution | null;
    readonly dataAcquisitionMs: NumericDistribution;
    readonly deserializationMs: NumericDistribution;
    readonly databaseWorkerCpuSystemMicros: NumericDistribution;
    readonly databaseWorkerCpuUserMicros: NumericDistribution;
    readonly databaseWorkerEventLoopDelayMaxMs: NumericDistribution;
    readonly databaseWorkerEventLoopDelayP95Ms: NumericDistribution;
    readonly databaseWorkerEventLoopDelayP99Ms: NumericDistribution;
    readonly databaseWorkerEventLoopUtilization: NumericDistribution;
    readonly databaseWorkerPeakExternalBytes: NumericDistribution;
    readonly databaseWorkerPeakHeapBytes: NumericDistribution;
    readonly databaseWorkerPostGcHeapBytes: NumericDistribution;
    readonly databaseWorkerRequestInvalidSampleCount: NumericDistribution;
    readonly databaseWorkerRequestEventLoopDelayMaxMs: NumericDistribution;
    readonly databaseWorkerRequestEventLoopDelayP95Ms: NumericDistribution;
    readonly databaseWorkerRequestEventLoopDelayP99Ms: NumericDistribution;
    readonly databaseWorkerRequestEventLoopUtilization: NumericDistribution;
    readonly databaseWorkerRequestTotalCount: NumericDistribution;
    readonly databaseWorkerRequestValidSampleCount: NumericDistribution;
    readonly jsonParsingMs: NumericDistribution;
    readonly mainCpuSystemMicros: NumericDistribution;
    readonly mainCpuUserMicros: NumericDistribution;
    readonly mainEventLoopDelayMaxMs: NumericDistribution;
    readonly mainEventLoopDelayP95Ms: NumericDistribution;
    readonly mainEventLoopDelayP99Ms: NumericDistribution;
    readonly mainPeakHeapBytes: NumericDistribution;
    readonly mainPeakRssBytes: NumericDistribution;
    readonly mainPostGcHeapBytes: NumericDistribution;
    readonly normalizationMs: NumericDistribution;
    readonly rendererActionLatencyMs: NumericDistribution | null;
    readonly rendererFrameGapMaxMs: NumericDistribution;
    readonly rendererFrameGapP95Ms: NumericDistribution;
    readonly rendererHeartbeatMaxMs: NumericDistribution;
    readonly rendererHeartbeatP95Ms: NumericDistribution;
    readonly rendererLongTaskCount: NumericDistribution;
    readonly rendererLongTaskMaxMs: NumericDistribution;
    readonly rendererNavigationLatencyMs: NumericDistribution | null;
    readonly rendererPeakHeapBytes: NumericDistribution;
    readonly rendererPeakRssBytes: NumericDistribution;
    readonly rendererPostGcHeapBytes: NumericDistribution;
    readonly rendererSearchLatencyMs: NumericDistribution | null;
    readonly serializationMs: NumericDistribution;
    readonly sqliteReadMs: NumericDistribution;
    readonly sqliteWriteMs: NumericDistribution;
    readonly storeUpdateMs: NumericDistribution;
    readonly structuredCloneProxyMs: NumericDistribution;
    readonly totalMs: NumericDistribution;
}

const SCENARIOS: readonly XtreamScenario[] = Object.freeze([
    Object.freeze({ id: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE }),
    Object.freeze({ id: XTREAM_SCENARIO_ID.REFRESH_LARGE }),
    Object.freeze({ id: XTREAM_SCENARIO_ID.DELETE_LARGE }),
    Object.freeze({ id: XTREAM_SCENARIO_ID.CANCEL_IMPORT }),
    Object.freeze({ id: XTREAM_SCENARIO_ID.BACKGROUND_UI }),
]);

export function listXtreamBenchmarkScenarios(): readonly XtreamScenario[] {
    return SCENARIOS;
}

export function createXtreamIterationDefinitions(
    smoke: boolean
): readonly XtreamIterationDefinition[] {
    const definitions: XtreamIterationDefinition[] = [];
    for (const scenario of SCENARIOS) {
        definitions.push(iteration(scenario.id, 'warmup-01', 'warmup', false));
        for (let index = 1; index <= (smoke ? 1 : 5); index += 1) {
            definitions.push(
                iteration(
                    scenario.id,
                    `run-${String(index).padStart(2, '0')}`,
                    'measured',
                    !smoke
                )
            );
        }
        definitions.push(
            iteration(scenario.id, 'diagnostic', 'diagnostic', false)
        );
    }
    return Object.freeze(definitions);
}

export function expectedXtreamWorkerRequestInventory(
    scenarioId: XtreamScenarioId
): readonly XtreamWorkerRequestInventoryEntry[] {
    return WORKER_REQUEST_INVENTORY[scenarioId];
}

const PHASES = Object.freeze({
    categoriesRead: ['sqlite.categories.read'],
    categoriesWrite: [
        'normalize.categories',
        'sqlite.categories.write-transactions',
    ],
    contentRead: ['sqlite.content.read'],
    contentWrite: [
        'sqlite.content.category-map-read',
        'normalize.content',
        'sqlite.content.write-transactions',
    ],
    playlistDelete: [
        'sqlite.playlist-delete.collect-ids',
        'sqlite.playlist-delete.write-transactions',
    ],
    playlistGet: ['sqlite.read', 'deserialize.playlist'],
    playlistUpsert: ['serialize.playlist', 'sqlite.write'],
    xtreamCacheClear: ['sqlite.xtream-cache-clear.write-transactions'],
    xtreamDelete: [
        'sqlite.xtream-delete.collect-user-data',
        'sqlite.xtream-delete.write-transactions',
    ],
});

const WORKER_REQUEST_INVENTORY: Readonly<
    Record<XtreamScenarioId, readonly XtreamWorkerRequestInventoryEntry[]>
> = Object.freeze({
    [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE]: inventory(
        request('DB_UPSERT_APP_PLAYLIST', 1, PHASES.playlistUpsert),
        request('DB_GET_PLAYLIST', 1),
        request('DB_GET_ALL_PLAYBACK_POSITIONS', 1),
        ...fullImportRequests()
    ),
    [XTREAM_SCENARIO_ID.REFRESH_LARGE]: refreshRequests(),
    [XTREAM_SCENARIO_ID.DELETE_LARGE]: inventory(
        request('DB_DELETE_PLAYLIST', 2, PHASES.playlistDelete)
    ),
    [XTREAM_SCENARIO_ID.CANCEL_IMPORT]: inventory(
        request('DB_UPSERT_APP_PLAYLIST', 1, PHASES.playlistUpsert),
        request('DB_GET_PLAYLIST', 1),
        request('DB_GET_ALL_PLAYBACK_POSITIONS', 1),
        request('DB_GET_APP_STATE', 4),
        request('DB_GET_CATEGORIES', 6, PHASES.categoriesRead),
        request('DB_SAVE_CATEGORIES', 3, PHASES.categoriesWrite),
        request('DB_GET_CONTENT', 1, PHASES.contentRead),
        request('DB_SAVE_CONTENT', 1, PHASES.contentWrite, false),
        request('DB_SET_APP_STATE', 3),
        request('DB_CLEAR_XTREAM_IMPORT_CACHE', 3, PHASES.xtreamCacheClear)
    ),
    [XTREAM_SCENARIO_ID.BACKGROUND_UI]: inventory(
        ...refreshRequests(),
        request('DB_GET_RECENTLY_VIEWED', 1),
        request('DB_GET_ALL_GLOBAL_FAVORITES', 1),
        request('DB_GET_GLOBAL_RECENTLY_ADDED', 1)
    ),
});

function fullImportRequests(
    reads: Readonly<{
        appState: number;
        categories: number;
        content: number;
        setAppState: number;
    }> = { appState: 6, categories: 6, content: 6, setAppState: 3 }
): readonly XtreamWorkerRequestInventoryEntry[] {
    return inventory(
        request('DB_GET_APP_STATE', reads.appState),
        request('DB_GET_CATEGORIES', reads.categories, PHASES.categoriesRead),
        request('DB_SAVE_CATEGORIES', 3, PHASES.categoriesWrite),
        request('DB_GET_CONTENT', reads.content, PHASES.contentRead),
        request('DB_SAVE_CONTENT', 3, PHASES.contentWrite),
        request('DB_SET_APP_STATE', reads.setAppState)
    );
}

function refreshRequests(): readonly XtreamWorkerRequestInventoryEntry[] {
    return inventory(
        request('DB_DELETE_XTREAM_CONTENT', 1, PHASES.xtreamDelete),
        request('DB_GET_ALL_PLAYBACK_POSITIONS', 1),
        request('DB_UPDATE_PLAYLIST', 1),
        request('DB_GET_APP_PLAYLIST', 1, PHASES.playlistGet),
        request('DB_GET_PLAYLIST', 2),
        request('DB_UPSERT_APP_PLAYLIST', 1, PHASES.playlistUpsert),
        ...fullImportRequests({
            appState: 12,
            categories: 9,
            content: 9,
            setAppState: 6,
        }),
        request('DB_RESTORE_XTREAM_USER_DATA', 1),
        request('DB_CLEAR_ALL_PLAYBACK_POSITIONS', 1)
    );
}

function inventory(
    ...entries: readonly XtreamWorkerRequestInventoryEntry[]
): readonly XtreamWorkerRequestInventoryEntry[] {
    return Object.freeze(entries);
}

function request(
    operation: string,
    count: number,
    phases: readonly string[] = [],
    success = true
): XtreamWorkerRequestInventoryEntry {
    return Object.freeze({
        count,
        operation,
        phases: Object.freeze([...phases]),
        success,
    });
}

function iteration(
    scenarioId: XtreamScenarioId,
    runId: string,
    kind: XtreamIterationKind,
    eligibleForComparison: boolean
): XtreamIterationDefinition {
    return Object.freeze({
        eligibleForComparison,
        kind,
        runId,
        scenarioId,
    });
}

export {
    assertXtreamArtifactRedacted,
    assertXtreamControlReadyAfterObservationReset,
    assertXtreamControlStateForScenario,
    assertXtreamManifest,
    assertXtreamManifestIdentity,
    assertXtreamMockOrigin,
    parseXtreamControlState,
} from './xtream-control-client';
