import {
    PERFORMANCE_PHASE_BOUNDARY,
    type AppPlaylistPerformancePhase,
    type PerformancePhaseEvent,
    type PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';
import type { WorkerPerformanceCapture } from './worker-performance-capture.model';
import { safeReadEpochMs } from './worker-performance-capture.runtime';

export function captureWorkerPerformancePhase<TResult>(
    capture: WorkerPerformanceCapture | null,
    phase: AppPlaylistPerformancePhase,
    execute: () => TResult,
    metadata?: (result: TResult) => PerformancePhaseMetadata
): TResult {
    if (!capture || !capture.requestId) {
        return execute();
    }

    const startMonotonicMs = safeReadMonotonicMs(capture);
    appendPhaseEvent(capture, {
        boundary: PERFORMANCE_PHASE_BOUNDARY.START,
        durationMs: null,
        epochMs: safeReadEpochMs(capture.runtime),
        metadata: undefined,
        phase,
        requestId: capture.requestId,
    });

    try {
        const result = execute();
        const endMonotonicMs = safeReadMonotonicMs(capture);
        appendPhaseEvent(capture, {
            boundary: PERFORMANCE_PHASE_BOUNDARY.END,
            durationMs: safeDuration(endMonotonicMs - startMonotonicMs),
            epochMs: safeReadEpochMs(capture.runtime),
            metadata: sanitizeMetadata(safelyCreateMetadata(metadata, result)),
            phase,
            requestId: capture.requestId,
        });
        return result;
    } catch (error) {
        const endMonotonicMs = safeReadMonotonicMs(capture);
        appendPhaseEvent(capture, {
            boundary: PERFORMANCE_PHASE_BOUNDARY.END,
            durationMs: safeDuration(endMonotonicMs - startMonotonicMs),
            epochMs: safeReadEpochMs(capture.runtime),
            metadata: undefined,
            phase,
            requestId: capture.requestId,
        });
        throw error;
    }
}

export function captureWorkerPerformancePhaseAsync<TResult>(
    capture: WorkerPerformanceCapture | null,
    phase: AppPlaylistPerformancePhase,
    execute: () => Promise<TResult>,
    metadata?: (result: TResult) => PerformancePhaseMetadata
): Promise<TResult> {
    const requestId = capture?.requestId;
    if (!capture || !requestId) {
        return execute();
    }

    return captureAsync(capture, requestId, phase, execute, metadata);
}

async function captureAsync<TResult>(
    capture: WorkerPerformanceCapture,
    requestId: string,
    phase: AppPlaylistPerformancePhase,
    execute: () => Promise<TResult>,
    metadata?: (result: TResult) => PerformancePhaseMetadata
): Promise<TResult> {
    const startMonotonicMs = safeReadMonotonicMs(capture);
    appendPhaseEvent(capture, {
        boundary: PERFORMANCE_PHASE_BOUNDARY.START,
        durationMs: null,
        epochMs: safeReadEpochMs(capture.runtime),
        metadata: undefined,
        phase,
        requestId,
    });

    try {
        const result = await execute();
        const endMonotonicMs = safeReadMonotonicMs(capture);
        appendPhaseEvent(capture, {
            boundary: PERFORMANCE_PHASE_BOUNDARY.END,
            durationMs: safeDuration(endMonotonicMs - startMonotonicMs),
            epochMs: safeReadEpochMs(capture.runtime),
            metadata: sanitizeMetadata(
                safelyCreateMetadata(metadata, result)
            ),
            phase,
            requestId,
        });
        return result;
    } catch (error) {
        const endMonotonicMs = safeReadMonotonicMs(capture);
        appendPhaseEvent(capture, {
            boundary: PERFORMANCE_PHASE_BOUNDARY.END,
            durationMs: safeDuration(endMonotonicMs - startMonotonicMs),
            epochMs: safeReadEpochMs(capture.runtime),
            metadata: undefined,
            phase,
            requestId,
        });
        throw error;
    }
}

function safeReadMonotonicMs(capture: WorkerPerformanceCapture): number {
    try {
        const value = capture.runtime.readMonotonicMs();
        return Number.isFinite(value) ? value : 0;
    } catch {
        return 0;
    }
}

function safeDuration(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safelyCreateMetadata<TResult>(
    createMetadata: ((result: TResult) => PerformancePhaseMetadata) | undefined,
    result: TResult
): PerformancePhaseMetadata | undefined {
    if (!createMetadata) {
        return undefined;
    }
    try {
        return createMetadata(result);
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

    const sanitized: { byteCount?: number; itemCount?: number } = {};
    if (isCount(metadata.byteCount)) {
        sanitized.byteCount = metadata.byteCount;
    }
    if (isCount(metadata.itemCount)) {
        sanitized.itemCount = metadata.itemCount;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function isCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

function appendPhaseEvent(
    capture: WorkerPerformanceCapture,
    event: PerformancePhaseEvent<AppPlaylistPerformancePhase>
): void {
    try {
        capture.phaseEvents.push(event);
    } catch {
        // Phase instrumentation is deliberately fail-neutral.
    }
}
