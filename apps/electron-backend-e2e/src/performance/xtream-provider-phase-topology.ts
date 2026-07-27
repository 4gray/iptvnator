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

    const account = semanticOne(spans, PHASE.RESPONSE_READY, SEMANTIC.ACCOUNT);
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
        const postRead = semanticOne(
            spans,
            PHASE.SQLITE_CATEGORIES_READ,
            category.type,
            category.count
        );
        ordered(account, preRead, response, normalization, write, postRead);
    }

    const expectedContent =
        scenarioId === 'xtream-cancel-import' ? CONTENT.slice(0, 1) : CONTENT;
    for (const content of expectedContent) {
        assertContentCausality(spans, content, scenarioId);
    }
}

function assertContentCausality(
    spans: readonly XtreamTopologyPhaseSpan[],
    content: (typeof CONTENT)[number],
    scenarioId: XtreamScenarioId
): void {
    const categoryStore = one(spans, PHASE.STORE_PUBLISH_CATEGORIES);
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
    const postRead = semanticOne(
        spans,
        PHASE.SQLITE_CONTENT_READ,
        content.type,
        content.itemCount
    );
    const store = semanticOne(
        spans,
        content.storePhase,
        content.type,
        content.itemCount
    );
    ordered(write, postRead, store);
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

function one(
    spans: readonly XtreamTopologyPhaseSpan[],
    phase: string
): XtreamTopologyPhaseSpan {
    const matches = spans.filter((span) => span.phase === phase);
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
