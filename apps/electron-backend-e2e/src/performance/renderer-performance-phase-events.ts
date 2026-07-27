export interface PairedRendererPerformancePhase {
    readonly durationMs: number;
    readonly endedEpochMs: number;
    readonly metadata: Readonly<{ items: number }> | null;
    readonly outcome: 'error' | 'success';
    readonly phase: string;
    readonly phaseId: string;
    readonly startedEpochMs: number;
}

interface ParsedRendererPerformancePhaseEvent {
    readonly boundary: 'end' | 'start';
    readonly epochMs: number;
    readonly metadata: Readonly<{ items: number }> | null;
    readonly monotonicMs: number;
    readonly outcome: 'error' | 'success' | null;
    readonly phase: string;
    readonly phaseId: string;
}

export function pairRendererPerformancePhaseEvents(
    input: readonly unknown[]
): readonly PairedRendererPerformancePhase[] {
    const grouped = new Map<string, ParsedRendererPerformancePhaseEvent[]>();

    for (const value of input) {
        const event = parseRendererPerformancePhaseEvent(value);
        const events = grouped.get(event.phaseId) ?? [];
        events.push(event);
        if (events.length > 2) {
            throw invalidRendererEvents();
        }
        grouped.set(event.phaseId, events);
    }

    const paired: PairedRendererPerformancePhase[] = [];
    for (const events of grouped.values()) {
        const start = events.find((event) => event.boundary === 'start');
        const end = events.find((event) => event.boundary === 'end');
        if (
            events.length !== 2 ||
            !start ||
            !end ||
            start.outcome !== null ||
            end.outcome === null ||
            start.phase !== end.phase ||
            !sameMetadata(start.metadata, end.metadata) ||
            end.epochMs < start.epochMs ||
            end.monotonicMs < start.monotonicMs
        ) {
            throw invalidRendererEvents();
        }
        paired.push(
            Object.freeze({
                durationMs: end.monotonicMs - start.monotonicMs,
                endedEpochMs: end.epochMs,
                metadata: end.metadata,
                outcome: end.outcome,
                phase: end.phase,
                phaseId: end.phaseId,
                startedEpochMs: start.epochMs,
            })
        );
    }

    paired.sort(
        (left, right) =>
            left.startedEpochMs - right.startedEpochMs ||
            left.endedEpochMs - right.endedEpochMs ||
            left.phaseId.localeCompare(right.phaseId)
    );
    return Object.freeze(paired);
}

export function requireRendererPerformancePhase(
    phases: readonly PairedRendererPerformancePhase[],
    phase: string
): PairedRendererPerformancePhase {
    const matches = phases.filter((candidate) => candidate.phase === phase);
    if (matches.length === 0) {
        throw new Error(`renderer-performance-phase-missing:${phase}`);
    }
    if (matches.length !== 1 || !matches[0]) {
        throw new Error(`renderer-performance-phase-ambiguous:${phase}`);
    }
    if (matches[0].outcome !== 'success') {
        throw new Error(`renderer-performance-phase-failed:${phase}`);
    }
    return matches[0];
}

function parseRendererPerformancePhaseEvent(
    value: unknown
): ParsedRendererPerformancePhaseEvent {
    if (!isRecord(value) || value['schemaVersion'] !== 1) {
        throw invalidRendererEvents();
    }
    const boundary = value['boundary'];
    const epochMs = value['epochMs'];
    const monotonicMs = value['monotonicMs'];
    const outcome = value['outcome'];
    const phase = value['phase'];
    const phaseId = value['phaseId'];
    if (
        (boundary !== 'start' && boundary !== 'end') ||
        !isFiniteNonNegativeNumber(epochMs) ||
        !isFiniteNonNegativeNumber(monotonicMs) ||
        typeof phase !== 'string' ||
        phase.length === 0 ||
        typeof phaseId !== 'string' ||
        phaseId.length === 0 ||
        (boundary === 'start' && outcome !== undefined) ||
        (boundary === 'end' && outcome !== 'success' && outcome !== 'error')
    ) {
        throw invalidRendererEvents();
    }

    return {
        boundary,
        epochMs,
        metadata: parseMetadata(value['metadata']),
        monotonicMs,
        outcome: outcome === 'success' || outcome === 'error' ? outcome : null,
        phase,
        phaseId,
    };
}

function parseMetadata(value: unknown): Readonly<{ items: number }> | null {
    if (value === undefined) {
        return null;
    }
    if (
        !isRecord(value) ||
        Object.keys(value).length !== 1 ||
        !Number.isSafeInteger(value['items']) ||
        Number(value['items']) < 0
    ) {
        throw invalidRendererEvents();
    }
    return Object.freeze({ items: Number(value['items']) });
}

function sameMetadata(
    left: Readonly<{ items: number }> | null,
    right: Readonly<{ items: number }> | null
): boolean {
    return left === null || right === null
        ? left === right
        : left.items === right.items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function invalidRendererEvents(): Error {
    return new Error('renderer-performance-phase-events-invalid');
}
