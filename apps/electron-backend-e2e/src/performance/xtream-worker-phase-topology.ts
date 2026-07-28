import { XTREAM_ATTRIBUTION_PHASE as PHASE } from './xtream-phase-inventory';
import type { XtreamTopologyPhaseSpan } from './xtream-phase-topology';

const CATEGORY_PHASES = new Set<string>([
    PHASE.NORMALIZE_CATEGORIES,
    PHASE.SQLITE_CATEGORIES_READ,
    PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
]);
const CONTENT_PHASES = new Set<string>([
    PHASE.NORMALIZE_CONTENT,
    PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
    PHASE.SQLITE_CONTENT_READ,
    PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
]);
const WORKER_REQUEST_SIGNATURES = [
    [PHASE.SERIALIZE_PLAYLIST, PHASE.SQLITE_GENERIC_WRITE],
    [PHASE.SQLITE_GENERIC_READ, PHASE.DESERIALIZE_PLAYLIST],
    [PHASE.SQLITE_CATEGORIES_READ],
    [PHASE.NORMALIZE_CATEGORIES, PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS],
    [PHASE.SQLITE_CONTENT_READ],
    [
        PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
        PHASE.NORMALIZE_CONTENT,
        PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
    ],
    [
        PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
        PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
    ],
    [PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS],
    [
        PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
        PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
    ],
    [PHASE.SQLITE_SEARCH_QUERY, PHASE.NORMALIZE_SEARCH_RANK],
] as const;
const WORKER_PHASES = new Set<string>(WORKER_REQUEST_SIGNATURES.flat());
const WORKER_SIGNATURES = new Set(
    WORKER_REQUEST_SIGNATURES.map(phaseSignature)
);

export function assertXtreamWorkerCorrelationOwnership(
    spans: readonly XtreamTopologyPhaseSpan[]
): void {
    const groups = new Map<string, XtreamTopologyPhaseSpan[]>();
    for (const span of spans) {
        if (!WORKER_PHASES.has(span.phase)) continue;
        if (!hasExpectedWorkerSource(span)) invalid();
        groups.set(span.correlationId, [
            ...(groups.get(span.correlationId) ?? []),
            span,
        ]);
    }
    for (const group of groups.values()) {
        if (
            new Set(group.map(({ semanticType }) => semanticType)).size !== 1 ||
            new Set(group.map(sourceDomain)).size !== 1 ||
            !WORKER_SIGNATURES.has(
                phaseSignature(group.map(({ phase }) => phase))
            )
        ) {
            invalid();
        }
    }
}

function sourceDomain(span: XtreamTopologyPhaseSpan): string {
    return `${span.providerAction ?? ''}\0${span.categoryType ?? ''}\0${span.contentType ?? ''}`;
}

function hasExpectedWorkerSource(span: XtreamTopologyPhaseSpan): boolean {
    if (CATEGORY_PHASES.has(span.phase)) {
        return (
            span.providerAction === null &&
            span.categoryType !== null &&
            span.contentType === null
        );
    }
    if (CONTENT_PHASES.has(span.phase)) {
        return (
            span.providerAction === null &&
            span.categoryType === null &&
            span.contentType !== null
        );
    }
    return (
        span.providerAction === null &&
        span.categoryType === null &&
        span.contentType === null
    );
}

function phaseSignature(phases: readonly string[]): string {
    return [...phases].sort().join('\0');
}

function invalid(): never {
    throw new Error('invalid worker correlation ownership');
}
