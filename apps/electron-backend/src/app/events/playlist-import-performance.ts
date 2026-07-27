import {
    M3U_IMPORT_PERFORMANCE_PHASE_EVENT_CHANNEL,
    PERFORMANCE_PHASE_BOUNDARY,
    type M3uImportPerformancePhase,
    type PerformancePhaseEvent,
    type PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';
import { randomUUID } from 'node:crypto';
import { channel, type Channel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

export interface M3uImportPerformanceCaptureRuntime {
    readonly createRequestId: () => string;
    readonly readEpochMs: () => number;
    readonly readMonotonicMs: () => number;
}

export interface M3uImportPerformanceCapture {
    measure<TResult>(
        phase: M3uImportPerformancePhase,
        execute: () => TResult,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ): TResult;
    measureAsync<TResult>(
        phase: M3uImportPerformancePhase,
        execute: () => Promise<TResult>,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ): Promise<TResult>;
}

interface CaptureOptions {
    readonly emit?: (
        event: PerformancePhaseEvent<M3uImportPerformancePhase>
    ) => void;
    readonly enabled: boolean;
    readonly requestId?: string;
    readonly runtime?: M3uImportPerformanceCaptureRuntime;
}

interface PhaseStart {
    readonly monotonicMs: number;
    readonly phase: M3uImportPerformancePhase;
}

const DEFAULT_RUNTIME: M3uImportPerformanceCaptureRuntime = {
    createRequestId: () => randomUUID(),
    readEpochMs: () => performance.timeOrigin + performance.now(),
    readMonotonicMs: () => performance.now(),
};

let performanceChannel: Channel | null = null;
let fallbackRequestSequence = 0;

export function publishM3uImportPerformancePhaseEvent(
    event: PerformancePhaseEvent<M3uImportPerformancePhase>
): void {
    try {
        performanceChannel ??= channel(
            M3U_IMPORT_PERFORMANCE_PHASE_EVENT_CHANNEL
        );
        performanceChannel.publish(event);
    } catch {
        // Development-only instrumentation must never affect playlist import.
    }
}

export function createM3uImportPerformanceCapture(
    options: CaptureOptions
): M3uImportPerformanceCapture | null {
    if (!options.enabled) {
        return null;
    }

    const runtime = options.runtime ?? DEFAULT_RUNTIME;
    const requestId =
        normalizeRequestId(options.requestId) ?? createRequestId(runtime);
    const emit = options.emit ?? publishM3uImportPerformancePhaseEvent;

    const begin = (phase: M3uImportPerformancePhase): PhaseStart => {
        const monotonicMs = safeReadMonotonicMs(runtime);
        safeEmit(emit, {
            boundary: PERFORMANCE_PHASE_BOUNDARY.START,
            durationMs: null,
            epochMs: safeReadEpochMs(runtime),
            metadata: undefined,
            phase,
            requestId,
        });
        return { monotonicMs, phase };
    };

    const end = (
        start: PhaseStart,
        createMetadata?: () => PerformancePhaseMetadata
    ): void => {
        const endedMonotonicMs = safeReadMonotonicMs(runtime);
        const durationMs = Math.max(0, endedMonotonicMs - start.monotonicMs);
        const epochMs = safeReadEpochMs(runtime);
        safeEmit(emit, {
            boundary: PERFORMANCE_PHASE_BOUNDARY.END,
            durationMs: Number.isFinite(durationMs) ? durationMs : 0,
            epochMs,
            metadata: sanitizeMetadata(safelyCreateMetadata(createMetadata)),
            phase: start.phase,
            requestId,
        });
    };

    return {
        measure: (phase, execute, metadata) => {
            const start = begin(phase);
            try {
                const result = execute();
                end(start, metadata ? () => metadata(result) : undefined);
                return result;
            } catch (error) {
                end(start);
                throw error;
            }
        },
        measureAsync: async (phase, execute, metadata) => {
            const start = begin(phase);
            try {
                const result = await execute();
                end(start, metadata ? () => metadata(result) : undefined);
                return result;
            } catch (error) {
                end(start);
                throw error;
            }
        },
    };
}

function createRequestId(runtime: M3uImportPerformanceCaptureRuntime): string {
    try {
        const requestId = normalizeRequestId(runtime.createRequestId());
        if (requestId) {
            return requestId;
        }
    } catch {
        // Fall through to a process-local, credential-free identifier.
    }
    fallbackRequestSequence += 1;
    return `m3u-import-${Date.now()}-${fallbackRequestSequence}`;
}

function normalizeRequestId(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function safeReadEpochMs(runtime: M3uImportPerformanceCaptureRuntime): number {
    try {
        const value = runtime.readEpochMs();
        return Number.isFinite(value) ? value : Date.now();
    } catch {
        return Date.now();
    }
}

function safeReadMonotonicMs(
    runtime: M3uImportPerformanceCaptureRuntime
): number {
    try {
        const value = runtime.readMonotonicMs();
        return Number.isFinite(value) ? value : 0;
    } catch {
        return 0;
    }
}

function safelyCreateMetadata(
    createMetadata: (() => PerformancePhaseMetadata) | undefined
): PerformancePhaseMetadata | undefined {
    if (!createMetadata) {
        return undefined;
    }
    try {
        return createMetadata();
    } catch {
        return undefined;
    }
}

function sanitizeMetadata(
    metadata: PerformancePhaseMetadata | undefined
): PerformancePhaseMetadata | undefined {
    if (!metadata) {
        return undefined;
    }

    const sanitized: PerformancePhaseMetadata = {};
    if (isCount(metadata.byteCount)) {
        (sanitized as { byteCount?: number }).byteCount = metadata.byteCount;
    }
    if (isCount(metadata.itemCount)) {
        (sanitized as { itemCount?: number }).itemCount = metadata.itemCount;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function isCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

function safeEmit(
    emit: (event: PerformancePhaseEvent<M3uImportPerformancePhase>) => void,
    event: PerformancePhaseEvent<M3uImportPerformancePhase>
): void {
    try {
        emit(event);
    } catch {
        // Instrumentation delivery is deliberately fail-neutral.
    }
}
