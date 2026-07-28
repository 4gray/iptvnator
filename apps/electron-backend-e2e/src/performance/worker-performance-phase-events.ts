import {
    APP_PLAYLIST_GET_PERFORMANCE_PHASE,
    APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE,
    type AppPlaylistPerformancePhase,
    type DatabaseWorkerPerformancePhase,
    type PerformancePhaseEvent,
    type PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';
import { fitsPerformanceDurationEnvelope } from './performance-phase-duration-envelope';
import { parseXtreamWorkerPerformancePhaseEvents } from './xtream-worker-phase-events';

const PHASE_SEQUENCES = {
    DB_GET_APP_PLAYLIST: [
        APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ,
        APP_PLAYLIST_GET_PERFORMANCE_PHASE.DESERIALIZE_PLAYLIST,
    ],
    DB_UPSERT_APP_PLAYLIST: [
        APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST,
        APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE,
    ],
} as const satisfies Readonly<
    Record<string, readonly AppPlaylistPerformancePhase[]>
>;
const EVENT_KEYS = new Set([
    'boundary',
    'durationMs',
    'epochMs',
    'metadata',
    'phase',
    'requestId',
]);

export function parseWorkerPerformancePhaseEvents(
    operation: string | null,
    input: unknown,
    workStartedEpochMs: number,
    workEndedEpochMs: number,
    requestSucceeded: boolean
): readonly PerformancePhaseEvent<DatabaseWorkerPerformancePhase>[] | null {
    const xtreamEvents = parseXtreamWorkerPerformancePhaseEvents(
        operation,
        input,
        workStartedEpochMs,
        workEndedEpochMs,
        requestSucceeded
    );
    if (xtreamEvents !== undefined) {
        return xtreamEvents;
    }

    const phaseSequence = getPhaseSequence(operation);
    if (phaseSequence.length === 0) {
        return input === undefined ||
            (Array.isArray(input) && input.length === 0)
            ? []
            : null;
    }
    if (!Array.isArray(input) || input.length !== phaseSequence.length * 2) {
        return null;
    }

    const parsed: PerformancePhaseEvent<AppPlaylistPerformancePhase>[] = [];
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
            phase: phase as AppPlaylistPerformancePhase,
            requestId,
        });
        lastEpochMs = epochMs;
    }
    return parsed;
}

function getPhaseSequence(
    operation: string | null
): readonly AppPlaylistPerformancePhase[] {
    if (operation === 'DB_GET_APP_PLAYLIST') {
        return PHASE_SEQUENCES.DB_GET_APP_PLAYLIST;
    }
    if (operation === 'DB_UPSERT_APP_PLAYLIST') {
        return PHASE_SEQUENCES.DB_UPSERT_APP_PLAYLIST;
    }
    return [];
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
