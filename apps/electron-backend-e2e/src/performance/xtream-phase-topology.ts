import type { XtreamScenarioId } from './xtream-benchmark-contract';
import {
    XTREAM_ATTRIBUTION_PHASE as PHASE,
    type XtreamPhaseSemanticType,
} from './xtream-phase-inventory';
import type {
    XtreamPhaseCategoryType,
    XtreamPhaseContentType,
    XtreamPhaseProviderAction,
} from './xtream-phase-semantic-source';
import { assertXtreamProviderCausality } from './xtream-provider-phase-topology';
import { assertXtreamRefreshRouteHydration } from './xtream-refresh-route-phase-topology';
import { assertXtreamWorkerCorrelationOwnership } from './xtream-worker-phase-topology';

export interface XtreamTopologyPhaseSpan {
    readonly categoryType: XtreamPhaseCategoryType | null;
    readonly contentType: XtreamPhaseContentType | null;
    readonly correlationId: string;
    readonly durationMs: number;
    readonly endEpochMs: number;
    readonly itemCount: number | null;
    readonly phase: string;
    readonly providerAction: XtreamPhaseProviderAction | null;
    readonly semanticType: XtreamPhaseSemanticType | null;
    readonly startEpochMs: number;
}

const CATEGORY_PHASES = new Set<string>([
    PHASE.NORMALIZE_CATEGORIES,
    PHASE.SQLITE_CATEGORIES_READ,
    PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
]);

export function assertXtreamPhaseTopology(
    scenarioId: XtreamScenarioId,
    spans: readonly XtreamTopologyPhaseSpan[]
): void {
    assertWorkerRequestChains(scenarioId, spans);
    assertCategoryCorrelation(scenarioId, spans);
    assertXtreamProviderCausality(scenarioId, spans);
    if (scenarioId === 'xtream-delete-large') {
        assertDeleteTopology(spans);
        return;
    }
    if (
        scenarioId === 'xtream-refresh-large' ||
        scenarioId === 'xtream-background-ui'
    ) {
        assertRefreshPrelude(spans);
    }
    if (scenarioId === 'xtream-cancel-import') {
        assertCancelTopology(spans);
        return;
    }
    assertFullImportTopology(scenarioId, spans);
}

function assertWorkerRequestChains(
    scenarioId: XtreamScenarioId,
    spans: readonly XtreamTopologyPhaseSpan[]
): void {
    assertXtreamWorkerCorrelationOwnership(spans);
    assertCorrelatedChains(spans, [
        PHASE.SERIALIZE_PLAYLIST,
        PHASE.SQLITE_GENERIC_WRITE,
    ]);
    assertCorrelatedChains(spans, [
        PHASE.SQLITE_GENERIC_READ,
        PHASE.DESERIALIZE_PLAYLIST,
    ]);
    assertCorrelatedChains(
        spans,
        [
            PHASE.NORMALIZE_CATEGORIES,
            PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
        ],
        [[0, 1]]
    );
    assertCorrelatedChains(
        spans,
        [
            PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
            PHASE.NORMALIZE_CONTENT,
            PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
        ],
        scenarioId === 'xtream-cancel-import' ? [] : [[1, 2]]
    );
    assertCorrelatedChains(spans, [
        PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
        PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
    ]);
    assertCorrelatedChains(spans, [
        PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
        PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
    ]);
}

function assertCorrelatedChains(
    spans: readonly XtreamTopologyPhaseSpan[],
    phases: readonly string[],
    equalItemCountIndexes: readonly (readonly [number, number])[] = []
): void {
    const phaseSet = new Set(phases);
    const selected = spans.filter(({ phase }) => phaseSet.has(phase));
    if (selected.length === 0) return;
    const groups = new Map<string, XtreamTopologyPhaseSpan[]>();
    for (const span of selected) {
        groups.set(span.correlationId, [
            ...(groups.get(span.correlationId) ?? []),
            span,
        ]);
    }
    for (const group of groups.values()) {
        const chain = phases.map((phase) => {
            const matches = group.filter((span) => span.phase === phase);
            const match = matches[0];
            if (matches.length !== 1 || !match) invalid();
            return match;
        });
        if (chain.length !== group.length) invalid();
        ordered(...chain);
        for (const [leftIndex, rightIndex] of equalItemCountIndexes) {
            const left = chain[leftIndex];
            const right = chain[rightIndex];
            if (!left || !right || left.itemCount !== right.itemCount)
                invalid();
        }
    }
}

function assertCategoryCorrelation(
    scenarioId: XtreamScenarioId,
    spans: readonly XtreamTopologyPhaseSpan[]
): void {
    if (select(spans, PHASE.NORMALIZE_CATEGORIES).length === 0) return;
    const completedReads = select(spans, PHASE.SQLITE_CATEGORIES_READ)
        .map(({ itemCount }) => itemCount)
        .filter((itemCount) => itemCount !== 0);
    const normalized = select(spans, PHASE.NORMALIZE_CATEGORIES).map(
        ({ itemCount }) => itemCount
    );
    const written = select(
        spans,
        PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS
    ).map(({ itemCount }) => itemCount);
    const expectedCompletedReads =
        scenarioId === 'xtream-refresh-large' ||
        scenarioId === 'xtream-background-ui'
            ? [...normalized, ...normalized]
            : normalized;
    if (
        !sameCountMultiset(completedReads, expectedCompletedReads) ||
        !sameCountMultiset(normalized, written)
    ) {
        invalid();
    }
}

function assertRefreshPrelude(spans: readonly XtreamTopologyPhaseSpan[]): void {
    const collect = one(spans, PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA);
    const write = one(spans, PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS);
    const refreshMeta = one(spans, PHASE.STORE_REFRESH_META);
    ordered(collect, write, refreshMeta);
    const importPrelude = spans.filter(
        ({ phase }) =>
            phase === PHASE.NETWORK_TOTAL ||
            phase === PHASE.JSON_TRANSFORM ||
            phase === PHASE.RESPONSE_READY ||
            phase === PHASE.SERIALIZE_PLAYLIST ||
            phase === PHASE.SQLITE_GENERIC_READ ||
            phase === PHASE.SQLITE_GENERIC_WRITE ||
            phase === PHASE.DESERIALIZE_PLAYLIST ||
            CATEGORY_PHASES.has(phase)
    );
    if (
        importPrelude.length === 0 ||
        refreshMeta.endEpochMs >
            Math.min(...importPrelude.map(({ startEpochMs }) => startEpochMs))
    ) {
        invalid();
    }
}

function assertFullImportTopology(
    scenarioId: XtreamScenarioId,
    spans: readonly XtreamTopologyPhaseSpan[]
): void {
    const routeHydratesAfterImport =
        scenarioId === 'xtream-refresh-large' ||
        scenarioId === 'xtream-background-ui';
    const categoryStores = select(spans, PHASE.STORE_PUBLISH_CATEGORIES);
    if (categoryStores.length !== (routeHydratesAfterImport ? 2 : 1)) {
        invalid();
    }
    const categoryStore = required(categoryStores, 0);
    assertCategoriesBeforeStore(spans, categoryStore);
    const storeGroups = [
        select(spans, PHASE.STORE_PUBLISH_LIVE),
        select(spans, PHASE.STORE_PUBLISH_VOD),
        select(spans, PHASE.STORE_PUBLISH_SERIES),
    ];
    const expectedStoreCount = routeHydratesAfterImport ? 2 : 1;
    if (storeGroups.some(({ length }) => length !== expectedStoreCount)) {
        invalid();
    }
    const stores = storeGroups.map((group) => required(group, 0));
    const terminals = select(spans, PHASE.STORE_IMPORT_TERMINAL);
    if (terminals.length !== expectedStoreCount) invalid();
    const terminal = required(terminals, 0);
    const reads = select(spans, PHASE.SQLITE_CONTENT_READ);
    const maps = select(spans, PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ);
    const normalizations = select(spans, PHASE.NORMALIZE_CONTENT);
    const writes = select(spans, PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS);
    if (
        reads.length !== (routeHydratesAfterImport ? 9 : 6) ||
        maps.length !== 3 ||
        normalizations.length !== 3 ||
        writes.length !== 3
    ) {
        invalid();
    }
    ordered(categoryStore, reads[0]);
    for (let index = 0; index < 3; index += 1) {
        const preRead = reads[index * 2];
        const postRead = reads[index * 2 + 1];
        ordered(
            preRead,
            maps[index],
            normalizations[index],
            writes[index],
            postRead,
            stores[index]
        );
        if (index < 2) ordered(stores[index], reads[(index + 1) * 2]);
    }
    ordered(stores[2], terminal);
    if (routeHydratesAfterImport) {
        assertXtreamRefreshRouteHydration(
            spans,
            terminal,
            required(categoryStores, 1),
            reads.slice(6),
            storeGroups.map((group) => required(group, 1)),
            required(terminals, 1)
        );
    } else {
        assertTerminalLast(spans, terminal);
    }
}

function assertCancelTopology(spans: readonly XtreamTopologyPhaseSpan[]): void {
    const categoryStore = one(spans, PHASE.STORE_PUBLISH_CATEGORIES);
    assertCategoriesBeforeStore(spans, categoryStore);
    const read = one(spans, PHASE.SQLITE_CONTENT_READ);
    const map = one(spans, PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ);
    const normalization = one(spans, PHASE.NORMALIZE_CONTENT);
    const write = one(spans, PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS);
    const cancel = one(spans, PHASE.CANCEL_SESSION);
    const cleanup = select(
        spans,
        PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS
    );
    const terminal = one(spans, PHASE.STORE_IMPORT_TERMINAL);
    if (cleanup.length !== 3) invalid();
    ordered(categoryStore, read, map, normalization, write);
    if (
        cancel.startEpochMs >= write.endEpochMs ||
        cancel.endEpochMs <= write.startEpochMs
    ) {
        invalid();
    }
    if (
        write.endEpochMs > cleanup[0].startEpochMs ||
        cancel.endEpochMs > cleanup[0].startEpochMs
    ) {
        invalid();
    }
    ordered(cleanup[0], cleanup[1], cleanup[2], terminal);
    assertTerminalLast(spans, terminal);
}

function assertDeleteTopology(spans: readonly XtreamTopologyPhaseSpan[]): void {
    const collects = select(spans, PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS);
    const writes = select(
        spans,
        PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS
    );
    const store = one(spans, PHASE.STORE_DELETE_ROW);
    if (collects.length !== 2 || writes.length !== 2) invalid();
    ordered(collects[0], writes[0], store, collects[1], writes[1]);
}

function assertCategoriesBeforeStore(
    spans: readonly XtreamTopologyPhaseSpan[],
    store: XtreamTopologyPhaseSpan
): void {
    const categories = spans.filter(
        ({ endEpochMs, phase }) =>
            CATEGORY_PHASES.has(phase) && endEpochMs <= store.startEpochMs
    );
    if (
        categories.length !== 12 ||
        Math.max(...categories.map(({ endEpochMs }) => endEpochMs)) >
            store.startEpochMs
    ) {
        invalid();
    }
}

function assertTerminalLast(
    spans: readonly XtreamTopologyPhaseSpan[],
    terminal: XtreamTopologyPhaseSpan
): void {
    if (
        spans.some(
            (span) =>
                span !== terminal && span.endEpochMs > terminal.startEpochMs
        )
    ) {
        invalid();
    }
}

function one(
    spans: readonly XtreamTopologyPhaseSpan[],
    phase: string
): XtreamTopologyPhaseSpan {
    const matches = spans.filter((span) => span.phase === phase);
    const match = matches[0];
    if (matches.length !== 1 || !match) invalid();
    return match;
}

function required<T>(values: readonly T[], index: number): T {
    const value = values[index];
    if (!value) invalid();
    return value;
}

function ordered(...spans: XtreamTopologyPhaseSpan[]): void {
    for (let index = 1; index < spans.length; index += 1) {
        if (spans[index - 1].endEpochMs > spans[index].startEpochMs) invalid();
    }
}

function select(
    spans: readonly XtreamTopologyPhaseSpan[],
    phase: string
): XtreamTopologyPhaseSpan[] {
    return spans
        .filter((span) => span.phase === phase)
        .sort((left, right) => left.startEpochMs - right.startEpochMs);
}

function sameCountMultiset(
    left: readonly (number | null)[],
    right: readonly (number | null)[]
): boolean {
    const sort = (values: readonly (number | null)[]) =>
        [...values].sort(
            (a, b) => (a === null ? -1 : a) - (b === null ? -1 : b)
        );
    return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}

function invalid(): never {
    throw new Error('invalid phase topology');
}
