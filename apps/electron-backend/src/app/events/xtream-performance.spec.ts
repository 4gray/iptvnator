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

function createRuntime(
    requestId = 'xtream-main-generated'
): XtreamMainPerformanceCaptureRuntime {
    let epochMs = 100;
    let monotonicMs = 10;
    return {
        createRequestId: jest.fn(() => requestId),
        readEpochMs: jest.fn(() => {
            epochMs += 10;
            return epochMs;
        }),
        readMonotonicMs: jest.fn(() => {
            monotonicMs += 2;
            return monotonicMs;
        }),
    };
}

function createCapture(
    events: MainPhaseEvent[],
    requestId = 'xtream-mabc1000-1',
    runtime = createRuntime()
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

describe('Xtream main-process performance capture', () => {
    it('does no identifier, clock, or sink work while disabled', () => {
        const runtime: XtreamMainPerformanceCaptureRuntime = {
            createRequestId: jest.fn(() => {
                throw new Error('identifier must stay untouched');
            }),
            readEpochMs: jest.fn(() => {
                throw new Error('epoch clock must stay untouched');
            }),
            readMonotonicMs: jest.fn(() => {
                throw new Error('monotonic clock must stay untouched');
            }),
        };
        const emit = jest.fn(() => {
            throw new Error('sink must stay untouched');
        });

        expect(
            createXtreamMainPerformanceCapture({
                emit,
                enabled: false,
                requestId: 'xtream-mabc1000-1',
                runtime,
            })
        ).toBeNull();
        expect(runtime.createRequestId).not.toHaveBeenCalled();
        expect(runtime.readEpochMs).not.toHaveBeenCalled();
        expect(runtime.readMonotonicMs).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('preserves nested async results and exact errors while closing every phase', async () => {
        const events: MainPhaseEvent[] = [];
        const capture = createCapture(events);
        const resultIdentity = { payload: 'same-object' };

        const result = await capture.measureAsync(
            XTREAM_MAIN_PERFORMANCE_PHASE.NETWORK_TOTAL,
            async () =>
                capture.measure(
                    XTREAM_MAIN_PERFORMANCE_PHASE.JSON_TRANSFORM,
                    () => resultIdentity
                )
        );

        expect(result).toBe(resultIdentity);
        expect(
            events.map(({ boundary, phase }) => ({ boundary, phase }))
        ).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_MAIN_PERFORMANCE_PHASE.NETWORK_TOTAL,
            },
            {
                boundary: 'start',
                phase: XTREAM_MAIN_PERFORMANCE_PHASE.JSON_TRANSFORM,
            },
            {
                boundary: 'end',
                phase: XTREAM_MAIN_PERFORMANCE_PHASE.JSON_TRANSFORM,
            },
            {
                boundary: 'end',
                phase: XTREAM_MAIN_PERFORMANCE_PHASE.NETWORK_TOTAL,
            },
        ]);

        const businessError = new Error('same-error');
        expect(() =>
            capture.measure(
                XTREAM_MAIN_PERFORMANCE_PHASE.CANCEL_SESSION,
                () => {
                    throw businessError;
                }
            )
        ).toThrow(businessError);
        expect(events.slice(-2).map(({ boundary }) => boundary)).toEqual([
            'start',
            'end',
        ]);
    });

    it('replays the exact Axios transform chain, context, headers, and status', () => {
        const events: MainPhaseEvent[] = [];
        const capture = createCapture(events);
        const context = {
            responseType: undefined,
        } as InternalAxiosRequestConfig;
        const headers = {
            normalize: jest.fn(function () {
                return this;
            }),
        } as unknown as AxiosResponseHeaders;
        const firstResult = { step: 1 };
        const finalResult = { step: 2 };
        const observations: unknown[] = [];
        const transforms: AxiosResponseTransformer[] = [
            function (data, receivedHeaders, status) {
                observations.push({
                    context: this,
                    data,
                    headers: receivedHeaders,
                    status,
                });
                return firstResult;
            },
            function (data, receivedHeaders, status) {
                observations.push({
                    context: this,
                    data,
                    headers: receivedHeaders,
                    status,
                });
                return finalResult;
            },
        ];
        const measured = createXtreamMeasuredTransformResponse(
            capture,
            transforms
        );

        const result = measured.call(context, 'raw-json', headers, 200);

        expect(result).toBe(finalResult);
        expect(observations).toEqual([
            {
                context,
                data: 'raw-json',
                headers,
                status: 200,
            },
            {
                context,
                data: firstResult,
                headers,
                status: 200,
            },
        ]);
        expect(headers.normalize).toHaveBeenCalledTimes(1);
        expect(
            events.filter(
                ({ phase }) =>
                    phase === XTREAM_MAIN_PERFORMANCE_PHASE.JSON_TRANSFORM
            )
        ).toHaveLength(2);
    });

    it('runs redirect transforms unchanged but emits one aggregate pair for the final response', () => {
        const events: MainPhaseEvent[] = [];
        const capture = createCapture(events);
        const transform = jest.fn(function (data: unknown) {
            return data;
        }) as AxiosResponseTransformer;
        const measured = createXtreamMeasuredTransformResponse(
            capture,
            transform
        );
        const context = {} as InternalAxiosRequestConfig;
        const headers = {} as AxiosResponseHeaders;

        expect(measured.call(context, 'redirect-body', headers, 302)).toBe(
            'redirect-body'
        );
        expect(measured.call(context, 'final-body', headers, 200)).toBe(
            'final-body'
        );
        expect(transform).toHaveBeenCalledTimes(2);
        expect(
            events.map(({ boundary, phase }) => ({ boundary, phase }))
        ).toEqual([
            {
                boundary: 'start',
                phase: XTREAM_MAIN_PERFORMANCE_PHASE.JSON_TRANSFORM,
            },
            {
                boundary: 'end',
                phase: XTREAM_MAIN_PERFORMANCE_PHASE.JSON_TRANSFORM,
            },
        ]);
    });
});
