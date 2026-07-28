import type {
    AxiosResponseHeaders,
    AxiosResponseTransformer,
    InternalAxiosRequestConfig,
} from 'axios';
import {
    PERFORMANCE_PHASE_BOUNDARY,
    XTREAM_MAIN_PERFORMANCE_PHASE,
    XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL,
    type PerformancePhaseEvent,
    type XtreamMainPerformancePhase,
} from '@iptvnator/shared/interfaces';
import { randomUUID } from 'node:crypto';
import { channel, type Channel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

export interface XtreamMainPerformanceCaptureRuntime {
    readonly createRequestId: () => string;
    readonly readEpochMs: () => number;
    readonly readMonotonicMs: () => number;
}

export interface XtreamMainPerformanceCapture {
    measure<TResult>(
        phase: XtreamMainPerformancePhase,
        execute: () => TResult
    ): TResult;
    measureAsync<TResult>(
        phase: XtreamMainPerformancePhase,
        execute: () => Promise<TResult>
    ): Promise<TResult>;
}

interface CaptureOptions {
    readonly emit?: (event: MainPhaseEvent) => void;
    readonly enabled: boolean;
    readonly requestId?: string;
    readonly runtime?: XtreamMainPerformanceCaptureRuntime;
}

interface PhaseStart {
    readonly monotonicMs: number;
    readonly phase: XtreamMainPerformancePhase;
}

type MainPhaseEvent = PerformancePhaseEvent<XtreamMainPerformancePhase>;
type TransformResponse =
    AxiosResponseTransformer | AxiosResponseTransformer[] | undefined;

const DEFAULT_RUNTIME: XtreamMainPerformanceCaptureRuntime = {
    createRequestId: () => `xtream-main-${randomUUID()}`,
    readEpochMs: () => performance.timeOrigin + performance.now(),
    readMonotonicMs: () => performance.now(),
};
const ENVIRONMENT_CAPTURE_ENABLED =
    process.env['IPTVNATOR_PERF_CAPTURE'] === '1';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const INTERNAL_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RENDERER_REQUEST_ID = /^xtream-[0-9a-z]+-[1-9][0-9]*$/;
const MAX_RENDERER_REQUEST_ID_LENGTH = 64;

let fallbackRequestSequence = 0;
let performanceChannel: Channel | null = null;

export function createXtreamMainPerformanceCaptureForRequest(
    requestId?: string
): XtreamMainPerformanceCapture | null {
    return ENVIRONMENT_CAPTURE_ENABLED
        ? createXtreamMainPerformanceCapture({
              enabled: true,
              requestId,
          })
        : null;
}

export function createXtreamMainPerformanceCapture(
    options: CaptureOptions
): XtreamMainPerformanceCapture | null {
    if (!options.enabled) {
        return null;
    }
    const runtime = options.runtime ?? DEFAULT_RUNTIME;
    const requestId =
        normalizeRendererRequestId(options.requestId) ??
        createRequestId(runtime);
    const emit = options.emit ?? publishXtreamMainPerformancePhaseEvent;
    let lastEpochMs = 0;
    const readEpochMs = (): number => {
        lastEpochMs = safeReadEpochMs(runtime, lastEpochMs);
        return lastEpochMs;
    };

    const begin = (phase: XtreamMainPerformancePhase): PhaseStart => {
        const monotonicMs = safeReadMonotonicMs(runtime);
        safeEmit(emit, {
            boundary: PERFORMANCE_PHASE_BOUNDARY.START,
            durationMs: null,
            epochMs: readEpochMs(),
            metadata: undefined,
            phase,
            requestId,
        });
        return { monotonicMs, phase };
    };
    const end = (start: PhaseStart): void => {
        const endedMonotonicMs = safeReadMonotonicMs(runtime);
        const durationMs = Math.max(0, endedMonotonicMs - start.monotonicMs);
        safeEmit(emit, {
            boundary: PERFORMANCE_PHASE_BOUNDARY.END,
            durationMs: Number.isFinite(durationMs) ? durationMs : 0,
            epochMs: readEpochMs(),
            metadata: undefined,
            phase: start.phase,
            requestId,
        });
    };

    return {
        measure: (phase, execute) => {
            const start = begin(phase);
            try {
                return execute();
            } finally {
                end(start);
            }
        },
        measureAsync: async (phase, execute) => {
            const start = begin(phase);
            try {
                return await execute();
            } finally {
                end(start);
            }
        },
    };
}

export function createXtreamMeasuredTransformResponse(
    capture: XtreamMainPerformanceCapture,
    configuredTransforms: TransformResponse
): AxiosResponseTransformer {
    const transforms = normalizeTransforms(configuredTransforms);
    return function measuredTransformResponse(data, headers, status) {
        const execute = () =>
            runTransformChain(transforms, this, data, headers, status);
        return status !== undefined && REDIRECT_STATUSES.has(status)
            ? execute()
            : capture.measure(
                  XTREAM_MAIN_PERFORMANCE_PHASE.JSON_TRANSFORM,
                  execute
              );
    };
}

function runTransformChain(
    transforms: readonly AxiosResponseTransformer[],
    context: InternalAxiosRequestConfig,
    initialData: unknown,
    headers: AxiosResponseHeaders,
    status: number | undefined
): unknown {
    let data = initialData;
    for (let index = 0; index < transforms.length; index += 1) {
        const transform = transforms[index];
        const normalizedHeaders =
            index === 0 ? headers : normalizeHeaders(headers);
        data = transform.call(context, data, normalizedHeaders, status);
    }
    return data;
}

function normalizeTransforms(
    transforms: TransformResponse
): readonly AxiosResponseTransformer[] {
    if (!transforms) {
        return [];
    }
    return Array.isArray(transforms) ? transforms.slice() : [transforms];
}

function normalizeHeaders(headers: AxiosResponseHeaders): AxiosResponseHeaders {
    const normalize = (
        headers as AxiosResponseHeaders & {
            normalize?: () => AxiosResponseHeaders;
        }
    ).normalize;
    return typeof normalize === 'function' ? normalize.call(headers) : headers;
}

function publishXtreamMainPerformancePhaseEvent(event: MainPhaseEvent): void {
    try {
        performanceChannel ??= channel(
            XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL
        );
        performanceChannel.publish(event);
    } catch {
        // Development-only instrumentation must never affect Xtream requests.
    }
}

function createRequestId(runtime: XtreamMainPerformanceCaptureRuntime): string {
    try {
        const requestId = normalizeInternalRequestId(runtime.createRequestId());
        if (requestId) {
            return requestId;
        }
    } catch {
        // Fall through to a process-local, credential-free identifier.
    }
    fallbackRequestSequence += 1;
    return `xtream-main-fallback-${fallbackRequestSequence}`;
}

function normalizeRendererRequestId(value: unknown): string | null {
    return typeof value === 'string' &&
        value.length <= MAX_RENDERER_REQUEST_ID_LENGTH &&
        RENDERER_REQUEST_ID.test(value)
        ? value
        : null;
}

function normalizeInternalRequestId(value: unknown): string | null {
    return typeof value === 'string' && INTERNAL_REQUEST_ID.test(value)
        ? value
        : null;
}

function safeReadEpochMs(
    runtime: XtreamMainPerformanceCaptureRuntime,
    previousEpochMs: number
): number {
    try {
        const value = runtime.readEpochMs();
        return Number.isFinite(value) && value > 0
            ? Math.max(previousEpochMs, value)
            : Math.max(previousEpochMs, 1);
    } catch {
        return Math.max(previousEpochMs, 1);
    }
}

function safeReadMonotonicMs(
    runtime: XtreamMainPerformanceCaptureRuntime
): number {
    try {
        const value = runtime.readMonotonicMs();
        return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
        return 0;
    }
}

function safeEmit(
    emit: (event: MainPhaseEvent) => void,
    event: MainPhaseEvent
) {
    try {
        emit(event);
    } catch {
        // Instrumentation delivery is deliberately fail-neutral.
    }
}
