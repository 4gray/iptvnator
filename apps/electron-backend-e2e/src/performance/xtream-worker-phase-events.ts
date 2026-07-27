import {
    XTREAM_DATABASE_PERFORMANCE_PHASE,
    type PerformancePhaseEvent,
    type PerformancePhaseMetadata,
    type XtreamDatabasePerformancePhase,
} from '@iptvnator/shared/interfaces';
import { fitsPerformanceDurationEnvelope } from './performance-phase-duration-envelope';

const PHASE_SEQUENCES = {
    DB_CLEAR_XTREAM_IMPORT_CACHE: [
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
    ],
    DB_DELETE_PLAYLIST: [
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
    ],
    DB_DELETE_XTREAM_CONTENT: [
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_XTREAM_DELETE_WRITE_TRANSACTIONS,
    ],
    DB_GET_CATEGORIES: [
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_READ,
    ],
    DB_GET_CONTENT: [XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_READ],
    DB_SAVE_CATEGORIES: [
        XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_CATEGORIES,
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
    ],
    DB_SAVE_CONTENT: [
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
        XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_CONTENT,
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
    ],
    DB_SEARCH_CONTENT: [
        XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_SEARCH_QUERY,
        XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_SEARCH_RANK,
    ],
} as const satisfies Readonly<
    Record<string, readonly XtreamDatabasePerformancePhase[]>
>;
const EVENT_KEYS = new Set([
    'boundary',
    'durationMs',
    'epochMs',
    'metadata',
    'phase',
    'requestId',
]);

export function parseXtreamWorkerPerformancePhaseEvents(
    operation: string | null,
    input: unknown,
    workStartedEpochMs: number,
    workEndedEpochMs: number,
    requestSucceeded: boolean
):
    | readonly PerformancePhaseEvent<XtreamDatabasePerformancePhase>[]
    | null
    | undefined {
    const phaseSequence =
        operation === null
            ? undefined
            : PHASE_SEQUENCES[operation as keyof typeof PHASE_SEQUENCES];
    if (!phaseSequence) {
        return undefined;
    }
    const completeEventCount = phaseSequence.length * 2;
    if (
        !Array.isArray(input) ||
        input.length === 0 ||
        input.length % 2 !== 0 ||
        input.length > completeEventCount ||
        (requestSucceeded && input.length !== completeEventCount)
    ) {
        return null;
    }

    const parsed: PerformancePhaseEvent<XtreamDatabasePerformancePhase>[] = [];
    let lastEpochMs = workStartedEpochMs;
    for (let index = 0; index < input.length; index += 1) {
        const raw = input[index];
        if (
            !isRecord(raw) ||
            Object.keys(raw).some((key) => !EVENT_KEYS.has(key))
        ) {
            return null;
        }
        const boundary = raw['boundary'];
        const durationMs = raw['durationMs'];
        const epochMs = raw['epochMs'];
        const metadata = parseMetadata(raw['metadata']);
        const phase = raw['phase'];
        const requestId = raw['requestId'];
        if (
            boundary !== (index % 2 === 0 ? 'start' : 'end') ||
            phase !== phaseSequence[Math.floor(index / 2)] ||
            typeof requestId !== 'string' ||
            requestId.length === 0 ||
            !isFiniteNonNegativeNumber(epochMs) ||
            epochMs < lastEpochMs ||
            epochMs > workEndedEpochMs ||
            (boundary === 'start' &&
                (durationMs !== null || metadata !== undefined)) ||
            (boundary === 'end' && !isFiniteNonNegativeNumber(durationMs)) ||
            (boundary === 'end' &&
                requestSucceeded &&
                metadata?.itemCount === undefined) ||
            metadata === null ||
            (parsed.length > 0 && parsed[0]?.requestId !== requestId)
        ) {
            return null;
        }
        const phaseStart = parsed[parsed.length - 1];
        if (
            boundary === 'end' &&
            (!phaseStart ||
                !fitsPerformanceDurationEnvelope(
                    Number(durationMs),
                    workStartedEpochMs,
                    workEndedEpochMs
                ))
        ) {
            return null;
        }
        parsed.push({
            boundary: boundary as 'end' | 'start',
            durationMs: durationMs as number | null,
            epochMs,
            ...(metadata === undefined ? {} : { metadata }),
            phase: phase as XtreamDatabasePerformancePhase,
            requestId,
        });
        lastEpochMs = epochMs;
    }
    return parsed;
}

function parseMetadata(
    input: unknown
): PerformancePhaseMetadata | undefined | null {
    if (input === undefined) {
        return undefined;
    }
    if (
        !isRecord(input) ||
        Object.keys(input).some(
            (key) => key !== 'byteCount' && key !== 'itemCount'
        )
    ) {
        return null;
    }
    const byteCount = input['byteCount'];
    const itemCount = input['itemCount'];
    if (
        (byteCount !== undefined && !isSafeCount(byteCount)) ||
        (itemCount !== undefined && !isSafeCount(itemCount))
    ) {
        return null;
    }
    return {
        ...(byteCount === undefined ? {} : { byteCount: Number(byteCount) }),
        ...(itemCount === undefined ? {} : { itemCount: Number(itemCount) }),
    };
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSafeCount(value: unknown): boolean {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
