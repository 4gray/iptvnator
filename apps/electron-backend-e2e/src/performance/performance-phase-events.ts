import type { PerformancePhaseMetadata } from '@iptvnator/shared/interfaces';

export interface PairedPerformancePhase {
    readonly durationMs: number;
    readonly endedEpochMs: number;
    readonly metadata: PerformancePhaseMetadata | null;
    readonly phase: string;
    readonly requestId: string;
    readonly startedEpochMs: number;
}

interface ParsedPerformancePhaseEvent {
    readonly boundary: 'end' | 'start';
    readonly durationMs: number | null;
    readonly epochMs: number;
    readonly metadata: PerformancePhaseMetadata | null;
    readonly phase: string;
    readonly requestId: string;
}

export interface DiagnosticsPerformancePhaseEventParserOptions {
    readonly allowedPhases: readonly string[];
    readonly timelineType: string;
}

export interface DiagnosticsPerformancePhaseTimelineEvent {
    readonly boundary: 'end' | 'start';
    readonly byteCount?: number;
    readonly durationMs: number | null;
    readonly epochMs: number;
    readonly itemCount?: number;
    readonly phase: string;
    readonly requestId: string;
    readonly type: string;
}

export function createDiagnosticsPerformancePhaseEventParser(
    options: DiagnosticsPerformancePhaseEventParserOptions
): (input: unknown) => DiagnosticsPerformancePhaseTimelineEvent | null {
    const allowedPhases = new Set(options.allowedPhases);
    const eventKeys = new Set([
        'boundary',
        'durationMs',
        'epochMs',
        'metadata',
        'phase',
        'requestId',
    ]);
    const metadataKeys = new Set(['byteCount', 'itemCount']);
    const helpers = {
        isCount(value: unknown): value is number {
            return Number.isSafeInteger(value) && Number(value) >= 0;
        },
        isRecord(value: unknown): value is Record<string, unknown> {
            return (
                typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value)
            );
        },
    };

    return (input: unknown) => {
        if (
            !helpers.isRecord(input) ||
            Object.keys(input).some((key) => !eventKeys.has(key))
        ) {
            return null;
        }
        const boundary = input['boundary'];
        const durationMs = input['durationMs'];
        const epochMs = input['epochMs'];
        const metadata = input['metadata'];
        const phase = input['phase'];
        const requestId = input['requestId'];
        if (
            (boundary !== 'start' && boundary !== 'end') ||
            typeof epochMs !== 'number' ||
            !Number.isFinite(epochMs) ||
            epochMs < 0 ||
            typeof phase !== 'string' ||
            !allowedPhases.has(phase) ||
            typeof requestId !== 'string' ||
            requestId.length === 0 ||
            (boundary === 'start' && durationMs !== null) ||
            (boundary === 'end' &&
                (typeof durationMs !== 'number' ||
                    !Number.isFinite(durationMs) ||
                    durationMs < 0))
        ) {
            return null;
        }
        if (
            metadata !== undefined &&
            (!helpers.isRecord(metadata) ||
                Object.keys(metadata).some((key) => !metadataKeys.has(key)) ||
                Object.values(metadata).some(
                    (value) => !helpers.isCount(value)
                ))
        ) {
            return null;
        }
        const byteCount = helpers.isRecord(metadata)
            ? metadata['byteCount']
            : undefined;
        const itemCount = helpers.isRecord(metadata)
            ? metadata['itemCount']
            : undefined;
        return {
            boundary,
            ...(helpers.isCount(byteCount) ? { byteCount } : {}),
            durationMs: durationMs as number | null,
            epochMs,
            ...(helpers.isCount(itemCount) ? { itemCount } : {}),
            phase,
            requestId,
            type: options.timelineType,
        };
    };
}

export function pairPerformancePhaseEvents(
    input: readonly unknown[]
): readonly PairedPerformancePhase[] {
    const grouped = new Map<string, ParsedPerformancePhaseEvent[]>();

    for (const value of input) {
        const event = parsePerformancePhaseEvent(value);
        const key = `${event.requestId}\u0000${event.phase}`;
        const events = grouped.get(key) ?? [];
        events.push(event);
        if (events.length > 2) {
            throw invalidPhaseEvents();
        }
        grouped.set(key, events);
    }

    const paired: PairedPerformancePhase[] = [];
    for (const events of grouped.values()) {
        const start = events.find((event) => event.boundary === 'start');
        const end = events.find((event) => event.boundary === 'end');
        if (
            events.length !== 2 ||
            !start ||
            !end ||
            start.durationMs !== null ||
            start.metadata !== null ||
            end.durationMs === null ||
            end.epochMs < start.epochMs
        ) {
            throw invalidPhaseEvents();
        }
        paired.push(
            Object.freeze({
                durationMs: end.durationMs,
                endedEpochMs: end.epochMs,
                metadata: end.metadata,
                phase: start.phase,
                requestId: start.requestId,
                startedEpochMs: start.epochMs,
            })
        );
    }

    paired.sort(
        (left, right) =>
            left.startedEpochMs - right.startedEpochMs ||
            left.endedEpochMs - right.endedEpochMs ||
            left.requestId.localeCompare(right.requestId) ||
            left.phase.localeCompare(right.phase)
    );
    return Object.freeze(paired);
}

export function requirePerformancePhase(
    phases: readonly PairedPerformancePhase[],
    requestId: string,
    phase: string
): PairedPerformancePhase {
    const matches = phases.filter(
        (candidate) =>
            candidate.requestId === requestId && candidate.phase === phase
    );
    if (matches.length === 0) {
        throw new Error(`performance-phase-missing:${requestId}:${phase}`);
    }
    if (matches.length !== 1 || !matches[0]) {
        throw new Error(`performance-phase-ambiguous:${requestId}:${phase}`);
    }
    return matches[0];
}

function parsePerformancePhaseEvent(
    value: unknown
): ParsedPerformancePhaseEvent {
    if (!isRecord(value)) {
        throw invalidPhaseEvents();
    }
    const boundary = value['boundary'];
    const durationMs = value['durationMs'];
    const epochMs = value['epochMs'];
    const phase = value['phase'];
    const requestId = value['requestId'];
    if (
        (boundary !== 'start' && boundary !== 'end') ||
        (durationMs !== null && !isFiniteNonNegativeNumber(durationMs)) ||
        !isFiniteNonNegativeNumber(epochMs) ||
        typeof phase !== 'string' ||
        phase.length === 0 ||
        typeof requestId !== 'string' ||
        requestId.length === 0
    ) {
        throw invalidPhaseEvents();
    }

    return {
        boundary,
        durationMs,
        epochMs,
        metadata: parseMetadata(value['metadata']),
        phase,
        requestId,
    };
}

function parseMetadata(value: unknown): PerformancePhaseMetadata | null {
    if (value === undefined) {
        return null;
    }
    if (!isRecord(value)) {
        throw invalidPhaseEvents();
    }
    const keys = Object.keys(value);
    if (
        keys.some((key) => key !== 'byteCount' && key !== 'itemCount') ||
        keys.some((key) => !isSafeCount(value[key]))
    ) {
        throw invalidPhaseEvents();
    }
    return Object.freeze({
        ...(value['byteCount'] === undefined
            ? {}
            : { byteCount: Number(value['byteCount']) }),
        ...(value['itemCount'] === undefined
            ? {}
            : { itemCount: Number(value['itemCount']) }),
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSafeCount(value: unknown): boolean {
    return (
        value === undefined ||
        (Number.isSafeInteger(value) && Number(value) >= 0)
    );
}

function invalidPhaseEvents(): Error {
    return new Error('performance-phase-events-invalid');
}
