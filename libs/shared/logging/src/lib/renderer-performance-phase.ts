export const RENDERER_PERFORMANCE_PHASE_HOOK_KEY =
    'iptvnator.renderer.performance-phase-hook.v1';

export const RENDERER_PERFORMANCE_PHASE = {
    M3U_IMPORT_DISPATCH: 'store.m3u-import-dispatch',
    M3U_PUBLISH_CHANNELS: 'store.m3u-publish-channels',
    XTREAM_DELETE_ROW: 'store.xtream-delete-row',
    XTREAM_IMPORT_TERMINAL: 'store.xtream-import-terminal',
    XTREAM_PUBLISH_CATEGORIES: 'store.xtream-publish-categories',
    XTREAM_PUBLISH_LIVE: 'store.xtream-publish-live',
    XTREAM_PUBLISH_SERIES: 'store.xtream-publish-series',
    XTREAM_PUBLISH_VOD: 'store.xtream-publish-vod',
    XTREAM_REFRESH_META: 'store.xtream-refresh-meta',
    XTREAM_SEARCH_RESULTS: 'store.xtream-search-results',
} as const;

export type RendererPerformancePhase =
    (typeof RENDERER_PERFORMANCE_PHASE)[keyof typeof RENDERER_PERFORMANCE_PHASE];

export type RendererPerformancePhaseBoundary = 'end' | 'start';
export type RendererPerformancePhaseOutcome = 'error' | 'success';

export interface RendererPerformancePhaseMetadata {
    readonly items: number;
}

export interface RendererPerformancePhaseEvent {
    readonly boundary: RendererPerformancePhaseBoundary;
    readonly epochMs: number;
    readonly metadata?: Readonly<RendererPerformancePhaseMetadata>;
    readonly monotonicMs: number;
    readonly outcome?: RendererPerformancePhaseOutcome;
    readonly phase: RendererPerformancePhase;
    readonly phaseId: string;
    readonly schemaVersion: 1;
}

export type RendererPerformancePhaseHook = (
    event: RendererPerformancePhaseEvent
) => void;

interface PhaseStart {
    readonly epochMs: number;
    readonly metadata?: Readonly<RendererPerformancePhaseMetadata>;
    readonly monotonicMs: number;
    readonly phase: RendererPerformancePhase;
    readonly phaseId: string;
}

interface PhaseTimestamp {
    readonly epochMs: number;
    readonly monotonicMs: number;
}

const hookSymbol = Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY);
let nextPhaseId = 0;

export function measureRendererPerformancePhase<T>(
    phase: RendererPerformancePhase,
    execute: () => T,
    createMetadata?: () => RendererPerformancePhaseMetadata
): T {
    const hook = readHook();
    if (hook === null) {
        return execute();
    }

    const start = beginPhase(phase, createMetadata);
    emit(hook, {
        boundary: 'start',
        epochMs: start.epochMs,
        metadata: start.metadata,
        monotonicMs: start.monotonicMs,
        phase: start.phase,
        phaseId: start.phaseId,
        schemaVersion: 1,
    });

    try {
        const result = execute();
        endPhase(hook, start, 'success');
        return result;
    } catch (error) {
        endPhase(hook, start, 'error');
        throw error;
    }
}

function beginPhase(
    phase: RendererPerformancePhase,
    createMetadata: (() => RendererPerformancePhaseMetadata) | undefined
): PhaseStart {
    const timestamp = sampleTimestamp();
    return {
        ...timestamp,
        metadata: readMetadata(createMetadata),
        phase,
        phaseId: `renderer-performance-${++nextPhaseId}`,
    };
}

function endPhase(
    hook: RendererPerformancePhaseHook,
    start: PhaseStart,
    outcome: RendererPerformancePhaseOutcome
): void {
    const sampled = sampleTimestamp();
    emit(hook, {
        boundary: 'end',
        epochMs: Math.max(start.epochMs, sampled.epochMs),
        metadata: start.metadata,
        monotonicMs: Math.max(start.monotonicMs, sampled.monotonicMs),
        outcome,
        phase: start.phase,
        phaseId: start.phaseId,
        schemaVersion: 1,
    });
}

function readHook(): RendererPerformancePhaseHook | null {
    try {
        const hook = (globalThis as unknown as Record<symbol, unknown>)[
            hookSymbol
        ];
        return typeof hook === 'function'
            ? (hook as RendererPerformancePhaseHook)
            : null;
    } catch {
        return null;
    }
}

function readMetadata(
    createMetadata: (() => RendererPerformancePhaseMetadata) | undefined
): Readonly<RendererPerformancePhaseMetadata> | undefined {
    if (createMetadata === undefined) {
        return undefined;
    }

    try {
        const items = createMetadata().items;
        return Number.isSafeInteger(items) && items >= 0
            ? Object.freeze({ items })
            : undefined;
    } catch {
        return undefined;
    }
}

function emit(
    hook: RendererPerformancePhaseHook,
    event: RendererPerformancePhaseEvent
): void {
    try {
        hook(Object.freeze(event));
    } catch {
        // Development-only benchmark instrumentation must stay fail-neutral.
    }
}

function sampleTimestamp(): PhaseTimestamp {
    const fallbackMs = readDateNow();
    try {
        const monotonicMs = globalThis.performance?.now();
        const timeOrigin = globalThis.performance?.timeOrigin;
        if (!Number.isFinite(monotonicMs)) {
            return { epochMs: fallbackMs, monotonicMs: fallbackMs };
        }
        const epochMs =
            Number.isFinite(timeOrigin) && timeOrigin !== undefined
                ? timeOrigin + monotonicMs
                : fallbackMs;
        return {
            epochMs: Number.isFinite(epochMs) ? epochMs : fallbackMs,
            monotonicMs,
        };
    } catch {
        return { epochMs: fallbackMs, monotonicMs: fallbackMs };
    }
}

function readDateNow(): number {
    try {
        const value = Date.now();
        return Number.isFinite(value) ? value : 0;
    } catch {
        return 0;
    }
}
