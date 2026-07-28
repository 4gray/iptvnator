import type { XtreamScenarioId } from './xtream-benchmark-contract';
import {
    XTREAM_ATTRIBUTION_PHASE as PHASE,
    XTREAM_PHASE_SEMANTIC_TYPE as SEMANTIC,
    type XtreamPhaseSemanticType,
} from './xtream-phase-inventory';
import type { XtreamTopologyPhaseSpan } from './xtream-phase-topology';

const CATEGORIES = [
    { count: 60, type: SEMANTIC.LIVE_CATEGORIES },
    { count: 20, type: SEMANTIC.VOD_CATEGORIES },
    { count: 20, type: SEMANTIC.SERIES_CATEGORIES },
] as const;
const CONTENT = [
    {
        categoryCount: 60,
        itemCount: 60_000,
        storePhase: PHASE.STORE_PUBLISH_LIVE,
        type: SEMANTIC.LIVE_CONTENT,
    },
    {
        categoryCount: 20,
        itemCount: 20_000,
        storePhase: PHASE.STORE_PUBLISH_VOD,
        type: SEMANTIC.VOD_CONTENT,
    },
    {
        categoryCount: 20,
        itemCount: 20_000,
        storePhase: PHASE.STORE_PUBLISH_SERIES,
        type: SEMANTIC.SERIES_CONTENT,
    },
] as const;
const CATEGORY_PHASES = new Set<string>([
    PHASE.NORMALIZE_CATEGORIES,
    PHASE.SQLITE_CATEGORIES_READ,
    PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
]);
const CATEGORY_TYPES = new Set<XtreamPhaseSemanticType>(
    CATEGORIES.map(({ type }) => type)
);
const CONTENT_PHASES = new Set<string>([
    PHASE.NORMALIZE_CONTENT,
    PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
    PHASE.SQLITE_CONTENT_READ,
    PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
]);
const CONTENT_TYPES = new Set<XtreamPhaseSemanticType>(
    CONTENT.map(({ type }) => type)
);
const PROVIDER_PHASES = new Set<string>([
    PHASE.JSON_TRANSFORM,
    PHASE.NETWORK_TOTAL,
    PHASE.RESPONSE_READY,
]);

export function assertXtreamProviderCausality(
    scenarioId: XtreamScenarioId,
    spans: readonly XtreamTopologyPhaseSpan[]
): void {
    assertSemanticOwnership(spans);
    if (scenarioId === 'xtream-delete-large') return;

    const routeHydratesAfterImport =
        scenarioId === 'xtream-refresh-large' ||
        scenarioId === 'xtream-background-ui';
    const accounts = semanticMany(spans, PHASE.NETWORK_TOTAL, SEMANTIC.ACCOUNT);
    if (accounts.length !== 2) invalid();
    if (
        accounts.some(
            (account, index) =>
                index > 0 &&
                required(accounts, index - 1).startEpochMs >=
                    account.startEpochMs
        )
    ) {
        invalid();
    }
    const accountResponses = accounts.map((network) =>
        accountResponse(spans, network)
    );
    // Fresh-add windows start the passive Sources check before route bootstrap,
    // so the later response gates the import. Refresh windows first run the
    // import and only then hydrate the recreated route from SQLite.
    const account = required(
        accountResponses,
        routeHydratesAfterImport ? 0 : accountResponses.length - 1
    );
    const routeAccount = routeHydratesAfterImport
        ? required(accountResponses, 1)
        : null;
    const routeAccountNetwork = routeHydratesAfterImport
        ? required(accounts, 1)
        : null;
    const routeStore = routeHydratesAfterImport
        ? required(phaseMany(spans, PHASE.STORE_PUBLISH_CATEGORIES), 1)
        : null;
    const terminal = routeHydratesAfterImport
        ? required(phaseMany(spans, PHASE.STORE_IMPORT_TERMINAL), 0)
        : null;
    if (
        routeAccount &&
        routeAccountNetwork &&
        terminal &&
        terminal.endEpochMs > routeAccountNetwork.startEpochMs
    ) {
        invalid();
    }
    for (const category of CATEGORIES) {
        const preRead = semanticOne(
            spans,
            PHASE.SQLITE_CATEGORIES_READ,
            category.type,
            0
        );
        const response = semanticOne(
            spans,
            PHASE.RESPONSE_READY,
            category.type
        );
        const normalization = semanticOne(
            spans,
            PHASE.NORMALIZE_CATEGORIES,
            category.type,
            category.count
        );
        const write = semanticOne(
            spans,
            PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
            category.type,
            category.count
        );
        const completedReads = semanticMany(
            spans,
            PHASE.SQLITE_CATEGORIES_READ,
            category.type
        ).filter(({ itemCount }) => itemCount === category.count);
        if (completedReads.length !== (routeHydratesAfterImport ? 2 : 1)) {
            invalid();
        }
        const postRead = required(completedReads, 0);
        ordered(account, preRead, response, normalization, write, postRead);
        if (routeAccount && routeStore) {
            ordered(routeAccount, required(completedReads, 1), routeStore);
        }
    }

    const expectedContent =
        scenarioId === 'xtream-cancel-import' ? CONTENT.slice(0, 1) : CONTENT;
    for (const content of expectedContent) {
        assertContentCausality(spans, content, scenarioId);
    }
}

function accountResponse(
    spans: readonly XtreamTopologyPhaseSpan[],
    network: XtreamTopologyPhaseSpan
): XtreamTopologyPhaseSpan {
    const transform = correlatedSemanticOne(
        spans,
        PHASE.JSON_TRANSFORM,
        SEMANTIC.ACCOUNT,
        network.correlationId
    );
    const response = correlatedSemanticOne(
        spans,
        PHASE.RESPONSE_READY,
        SEMANTIC.ACCOUNT,
        network.correlationId
    );
    if (
        network.startEpochMs > transform.startEpochMs ||
        transform.endEpochMs > network.endEpochMs ||
        network.endEpochMs > response.startEpochMs
    ) {
        invalid();
    }
    return response;
}

function assertContentCausality(
    spans: readonly XtreamTopologyPhaseSpan[],
    content: (typeof CONTENT)[number],
    scenarioId: XtreamScenarioId
): void {
    const categoryStore = required(
        phaseMany(spans, PHASE.STORE_PUBLISH_CATEGORIES),
        0
    );
    const preRead = semanticOne(
        spans,
        PHASE.SQLITE_CONTENT_READ,
        content.type,
        0
    );
    const response = semanticOne(spans, PHASE.RESPONSE_READY, content.type);
    const categoryMap = semanticOne(
        spans,
        PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
        content.type,
        content.categoryCount
    );
    const normalization = semanticOne(
        spans,
        PHASE.NORMALIZE_CONTENT,
        content.type,
        content.itemCount
    );
    const write = semanticOne(
        spans,
        PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
        content.type,
        scenarioId === 'xtream-cancel-import' ? null : content.itemCount
    );
    ordered(
        categoryStore,
        preRead,
        response,
        categoryMap,
        normalization,
        write
    );
    if (scenarioId === 'xtream-cancel-import') return;
    const routeHydratesAfterImport =
        scenarioId === 'xtream-refresh-large' ||
        scenarioId === 'xtream-background-ui';
    const completedReads = semanticMany(
        spans,
        PHASE.SQLITE_CONTENT_READ,
        content.type
    ).filter(({ itemCount }) => itemCount === content.itemCount);
    const stores = semanticMany(spans, content.storePhase, content.type).filter(
        ({ itemCount }) => itemCount === content.itemCount
    );
    const expectedCount = routeHydratesAfterImport ? 2 : 1;
    if (
        completedReads.length !== expectedCount ||
        stores.length !== expectedCount
    ) {
        invalid();
    }
    ordered(write, required(completedReads, 0), required(stores, 0));
    if (routeHydratesAfterImport) {
        const routeCategoryStore = required(
            phaseMany(spans, PHASE.STORE_PUBLISH_CATEGORIES),
            1
        );
        ordered(
            routeCategoryStore,
            required(completedReads, 1),
            required(stores, 1)
        );
    }
}

function assertSemanticOwnership(
    spans: readonly XtreamTopologyPhaseSpan[]
): void {
    for (const span of spans) {
        if (PROVIDER_PHASES.has(span.phase)) {
            if (span.semanticType === null) invalid();
            continue;
        }
        if (CATEGORY_PHASES.has(span.phase)) {
            if (
                span.semanticType === null ||
                !CATEGORY_TYPES.has(span.semanticType)
            ) {
                invalid();
            }
            continue;
        }
        if (CONTENT_PHASES.has(span.phase)) {
            if (
                span.semanticType === null ||
                !CONTENT_TYPES.has(span.semanticType)
            ) {
                invalid();
            }
            continue;
        }
        const expectedStoreType = storeSemanticType(span.phase);
        if (
            (expectedStoreType === null && span.semanticType !== null) ||
            (expectedStoreType !== null &&
                span.semanticType !== expectedStoreType)
        ) {
            invalid();
        }
    }
}

function storeSemanticType(phase: string): XtreamPhaseSemanticType | null {
    if (phase === PHASE.STORE_PUBLISH_LIVE) return SEMANTIC.LIVE_CONTENT;
    if (phase === PHASE.STORE_PUBLISH_VOD) return SEMANTIC.VOD_CONTENT;
    if (phase === PHASE.STORE_PUBLISH_SERIES) return SEMANTIC.SERIES_CONTENT;
    return null;
}

function semanticOne(
    spans: readonly XtreamTopologyPhaseSpan[],
    phase: string,
    semanticType: XtreamPhaseSemanticType,
    itemCount?: number | null
): XtreamTopologyPhaseSpan {
    const matches = spans.filter(
        (span) =>
            span.phase === phase &&
            span.semanticType === semanticType &&
            (itemCount === undefined || span.itemCount === itemCount)
    );
    if (matches.length !== 1) invalid();
    return required(matches, 0);
}

function semanticMany(
    spans: readonly XtreamTopologyPhaseSpan[],
    phase: string,
    semanticType: XtreamPhaseSemanticType
): XtreamTopologyPhaseSpan[] {
    return spans
        .filter(
            (span) => span.phase === phase && span.semanticType === semanticType
        )
        .sort((left, right) => left.startEpochMs - right.startEpochMs);
}

function phaseMany(
    spans: readonly XtreamTopologyPhaseSpan[],
    phase: string
): XtreamTopologyPhaseSpan[] {
    return spans
        .filter((span) => span.phase === phase)
        .sort((left, right) => left.startEpochMs - right.startEpochMs);
}

function correlatedSemanticOne(
    spans: readonly XtreamTopologyPhaseSpan[],
    phase: string,
    semanticType: XtreamPhaseSemanticType,
    correlationId: string
): XtreamTopologyPhaseSpan {
    const matches = spans.filter(
        (span) =>
            span.phase === phase &&
            span.semanticType === semanticType &&
            span.correlationId === correlationId
    );
    if (matches.length !== 1) invalid();
    return required(matches, 0);
}

function ordered(...spans: readonly XtreamTopologyPhaseSpan[]): void {
    for (let index = 1; index < spans.length; index += 1) {
        if (
            required(spans, index - 1).endEpochMs >
            required(spans, index).startEpochMs
        ) {
            invalid();
        }
    }
}

function required<T>(values: readonly T[], index: number): T {
    const value = values[index];
    if (!value) invalid();
    return value;
}

function invalid(): never {
    throw new Error('invalid provider phase topology');
}
