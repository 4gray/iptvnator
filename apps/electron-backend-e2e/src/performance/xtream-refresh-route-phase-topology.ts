import { XTREAM_ATTRIBUTION_PHASE as PHASE } from './xtream-phase-inventory';
import type { XtreamTopologyPhaseSpan } from './xtream-phase-topology';

const EXPECTED_ROUTE_CONTENT = [
    {
        count: 60_000,
        semanticType: 'live-content',
        storePhase: PHASE.STORE_PUBLISH_LIVE,
    },
    {
        count: 20_000,
        semanticType: 'vod-content',
        storePhase: PHASE.STORE_PUBLISH_VOD,
    },
    {
        count: 20_000,
        semanticType: 'series-content',
        storePhase: PHASE.STORE_PUBLISH_SERIES,
    },
] as const;

export function assertXtreamRefreshRouteHydration(
    spans: readonly XtreamTopologyPhaseSpan[],
    terminal: XtreamTopologyPhaseSpan,
    routeCategoryStore: XtreamTopologyPhaseSpan,
    routeContentReads: readonly XtreamTopologyPhaseSpan[],
    routeContentStores: readonly XtreamTopologyPhaseSpan[],
    routeTerminal: XtreamTopologyPhaseSpan
): void {
    const categoryReads = select(spans, PHASE.SQLITE_CATEGORIES_READ).filter(
        ({ startEpochMs }) => startEpochMs >= terminal.endEpochMs
    );
    if (
        categoryReads.length !== 3 ||
        !sameCountMultiset(
            categoryReads.map(({ itemCount }) => itemCount),
            [60, 20, 20]
        ) ||
        new Set(categoryReads.map(({ semanticType }) => semanticType)).size !==
            3 ||
        categoryReads.some(
            ({ endEpochMs, startEpochMs }) =>
                terminal.endEpochMs > startEpochMs ||
                endEpochMs > routeCategoryStore.startEpochMs
        )
    ) {
        invalid();
    }
    if (
        routeContentReads.length !== EXPECTED_ROUTE_CONTENT.length ||
        routeContentStores.length !== EXPECTED_ROUTE_CONTENT.length
    ) {
        invalid();
    }
    const sequence = [routeCategoryStore];
    for (const [index, item] of EXPECTED_ROUTE_CONTENT.entries()) {
        const read = required(routeContentReads, index);
        const store = required(routeContentStores, index);
        if (
            read.itemCount !== item.count ||
            read.semanticType !== item.semanticType ||
            store.phase !== item.storePhase ||
            store.itemCount !== item.count ||
            store.semanticType !== item.semanticType
        ) {
            invalid();
        }
        sequence.push(read, store);
    }
    ordered(...sequence, routeTerminal);
    assertTerminalLast(spans, routeTerminal);
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
