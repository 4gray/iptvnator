import type {
    AxiosResponseHeaders,
    AxiosResponseTransformer,
    InternalAxiosRequestConfig,
} from 'axios';
import {
    XTREAM_MAIN_PERFORMANCE_PHASE,
    type PerformancePhaseEvent,
    type XtreamMainPerformancePhase,
} from '@iptvnator/shared/interfaces';
import {
    createXtreamMainPerformanceCapture,
    createXtreamMeasuredTransformResponse,
    type XtreamMainPerformanceCapture,
    type XtreamMainPerformanceCaptureRuntime,
} from './xtream-performance';

type MainPhaseEvent = PerformancePhaseEvent<XtreamMainPerformancePhase>;

function requireCapture(
    runtime: XtreamMainPerformanceCaptureRuntime,
    events: MainPhaseEvent[],
    requestId?: string
): XtreamMainPerformanceCapture {
    const capture = createXtreamMainPerformanceCapture({
        emit: (event) => events.push(event),
        enabled: true,
        requestId,
        runtime,
    });
    if (!capture) {
        throw new Error('Expected performance capture');
    }
    return capture;
}

describe('Xtream main performance runtime hardening', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('uses a clock-free safe identifier and epoch when every injected clock throws', () => {
        const events: MainPhaseEvent[] = [];
        const runtime: XtreamMainPerformanceCaptureRuntime = {
            createRequestId: jest.fn(() => {
                throw new Error('identifier failed');
            }),
            readEpochMs: jest.fn(() => {
                throw new Error('epoch failed');
            }),
            readMonotonicMs: jest.fn(() => {
                throw new Error('monotonic failed');
            }),
        };
        const wallClock = jest.spyOn(Date, 'now').mockImplementation(() => {
            throw new Error('wall clock must stay untouched');
        });
        let capture: XtreamMainPerformanceCapture | undefined;

        expect(() => {
            capture = requireCapture(runtime, events, ' unsafe request id ');
        }).not.toThrow();
        expect(() =>
            capture?.measure(
                XTREAM_MAIN_PERFORMANCE_PHASE.RESPONSE_READY,
                () => undefined
            )
        ).not.toThrow();

        expect(wallClock).not.toHaveBeenCalled();
        expect(events).toHaveLength(2);
        expect(
            events.every(
                ({ epochMs, requestId }) =>
                    Number.isFinite(epochMs) &&
                    epochMs > 0 &&
                    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)
            )
        ).toBe(true);
    });

    it('keeps emitted epochs positive, finite, and nondecreasing across invalid and backward samples', () => {
        const events: MainPhaseEvent[] = [];
        const epochSamples = [Number.NaN, 100, 90, Number.POSITIVE_INFINITY];
        const runtime: XtreamMainPerformanceCaptureRuntime = {
            createRequestId: jest.fn(() => 'unused'),
            readEpochMs: jest.fn(() => epochSamples.shift() ?? 80),
            readMonotonicMs: jest.fn(() => 10),
        };
        const capture = requireCapture(runtime, events, 'xtream-mabc1001-1');

        capture.measure(
            XTREAM_MAIN_PERFORMANCE_PHASE.NETWORK_TOTAL,
            () => undefined
        );
        capture.measure(
            XTREAM_MAIN_PERFORMANCE_PHASE.RESPONSE_READY,
            () => undefined
        );

        const epochs = events.map(({ epochMs }) => epochMs);
        expect(epochs.every((epochMs) => Number.isFinite(epochMs))).toBe(true);
        expect(epochs.every((epochMs) => epochMs > 0)).toBe(true);
        expect(
            epochs.every(
                (epochMs, index) => index === 0 || epochMs >= epochs[index - 1]
            )
        ).toBe(true);
    });

    it('matches Axios by visiting a sparse transform entry and closing the failed JSON phase', () => {
        const events: MainPhaseEvent[] = [];
        const runtime: XtreamMainPerformanceCaptureRuntime = {
            createRequestId: jest.fn(() => 'unused'),
            readEpochMs: jest.fn(() => 100),
            readMonotonicMs: jest.fn(() => 10),
        };
        const capture = requireCapture(runtime, events, 'xtream-mabc1002-2');
        const sparseTransforms = new Array<AxiosResponseTransformer>(1);
        const measured = createXtreamMeasuredTransformResponse(
            capture,
            sparseTransforms
        );

        expect(() =>
            measured.call(
                {} as InternalAxiosRequestConfig,
                'raw',
                {} as AxiosResponseHeaders,
                200
            )
        ).toThrow(TypeError);
        expect(events.map(({ boundary }) => boundary)).toEqual([
            'start',
            'end',
        ]);
    });

    it('is fail-neutral and never publishes unsafe request identifiers or business data', () => {
        const runtime: XtreamMainPerformanceCaptureRuntime = {
            createRequestId: jest.fn(() => 'xtream-main-safe-fallback'),
            readEpochMs: jest.fn(() => 100),
            readMonotonicMs: jest.fn(() => 10),
        };
        const capture = createXtreamMainPerformanceCapture({
            emit: () => {
                throw new Error('diagnostics sink failed');
            },
            enabled: true,
            requestId: 'provider-password-secret',
            runtime,
        });
        const businessError = new Error('provider-password-secret');

        expect(() =>
            capture?.measure(
                XTREAM_MAIN_PERFORMANCE_PHASE.JSON_TRANSFORM,
                () => {
                    throw businessError;
                }
            )
        ).toThrow(businessError);
        expect(runtime.createRequestId).toHaveBeenCalledTimes(1);

        const events: MainPhaseEvent[] = [];
        const safeCapture = requireCapture(
            runtime,
            events,
            'provider-password-secret'
        );
        safeCapture.measure(
            XTREAM_MAIN_PERFORMANCE_PHASE.RESPONSE_READY,
            () => ({ secret: 'response-body-secret' })
        );
        expect(
            events.every(
                ({ requestId }) => requestId === 'xtream-main-safe-fallback'
            )
        ).toBe(true);
        const serialized = JSON.stringify(events);
        expect(serialized).not.toContain('provider-password-secret');
        expect(serialized).not.toContain('response-body-secret');
        expect(
            events.every(
                (event) =>
                    event.metadata === undefined &&
                    Object.keys(event).every((key) =>
                        [
                            'boundary',
                            'durationMs',
                            'epochMs',
                            'metadata',
                            'phase',
                            'requestId',
                        ].includes(key)
                    )
            )
        ).toBe(true);
    });

    it('correlates only the renderer-generated Xtream request ID shape', () => {
        const events: MainPhaseEvent[] = [];
        const runtime: XtreamMainPerformanceCaptureRuntime = {
            createRequestId: jest.fn(() => 'xtream-main-unused'),
            readEpochMs: jest.fn(() => 100),
            readMonotonicMs: jest.fn(() => 10),
        };
        const capture = requireCapture(runtime, events, 'xtream-mabc1234-17');

        capture.measure(
            XTREAM_MAIN_PERFORMANCE_PHASE.RESPONSE_READY,
            () => undefined
        );

        expect(events.map(({ requestId }) => requestId)).toEqual([
            'xtream-mabc1234-17',
            'xtream-mabc1234-17',
        ]);
        expect(runtime.createRequestId).not.toHaveBeenCalled();
    });

    it('keeps overlapping request phases isolated by capture-local request ID', async () => {
        const events: MainPhaseEvent[] = [];
        const runtime: XtreamMainPerformanceCaptureRuntime = {
            createRequestId: jest.fn(() => 'unused'),
            readEpochMs: jest.fn(() => 100),
            readMonotonicMs: jest.fn(() => 10),
        };
        const first = requireCapture(runtime, events, 'xtream-mabc1003-3');
        const second = requireCapture(runtime, events, 'xtream-mabc1004-4');
        let resolveFirst!: () => void;
        let resolveSecond!: () => void;
        const firstWork = new Promise<void>((resolve) => {
            resolveFirst = resolve;
        });
        const secondWork = new Promise<void>((resolve) => {
            resolveSecond = resolve;
        });

        const firstResult = first.measureAsync(
            XTREAM_MAIN_PERFORMANCE_PHASE.NETWORK_TOTAL,
            () => firstWork
        );
        const secondResult = second.measureAsync(
            XTREAM_MAIN_PERFORMANCE_PHASE.NETWORK_TOTAL,
            () => secondWork
        );
        resolveSecond();
        await secondResult;
        resolveFirst();
        await firstResult;

        for (const requestId of ['xtream-mabc1003-3', 'xtream-mabc1004-4']) {
            const requestEvents = events.filter(
                (event) => event.requestId === requestId
            );
            expect(requestEvents.map(({ boundary }) => boundary)).toEqual([
                'start',
                'end',
            ]);
        }
    });
});
