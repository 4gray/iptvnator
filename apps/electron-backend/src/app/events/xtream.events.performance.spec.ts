import type { AxiosRequestConfig } from 'axios';
import {
    XTREAM_CANCEL_SESSION,
    XTREAM_MAIN_PERFORMANCE_PHASE,
    XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL,
    type PerformancePhaseEvent,
    type XtreamMainPerformancePhase,
} from '@iptvnator/shared/interfaces';
import { channel } from 'node:diagnostics_channel';
import {
    applyConfiguredTransforms,
    axiosMock,
    createDeferred,
    getDefaultsReadCount,
    getHandler,
    loadXtreamEvents,
    mockFinalizeTransform,
    mockParseTransform,
} from './xtream.events.performance.test-helpers';

type MainPhaseEvent = PerformancePhaseEvent<XtreamMainPerformancePhase>;

describe('XtreamEvents performance phases', () => {
    const originalCaptureValue = process.env['IPTVNATOR_PERF_CAPTURE'];

    afterEach(() => {
        if (originalCaptureValue === undefined) {
            delete process.env['IPTVNATOR_PERF_CAPTURE'];
        } else {
            process.env['IPTVNATOR_PERF_CAPTURE'] = originalCaptureValue;
        }
        jest.restoreAllMocks();
    });

    it.each([undefined, 'true', 'yes', 'on', ' 1 ', '0'])(
        'keeps the Axios path untouched for non-exact capture value %p',
        async (captureValue) => {
            const events: MainPhaseEvent[] = [];
            const phaseChannel = channel(
                XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL
            );
            const subscriber = (event: unknown) =>
                events.push(event as MainPhaseEvent);
            phaseChannel.subscribe(subscriber);
            try {
                await loadXtreamEvents(captureValue);
                axiosMock.mockImplementation((config: AxiosRequestConfig) =>
                    Promise.resolve({
                        config,
                        data: { same: 'identity' },
                        headers: {},
                        status: 200,
                        statusText: 'OK',
                    })
                );

                await getHandler('XTREAM_REQUEST')(
                    {},
                    {
                        params: { action: 'get_live_categories' },
                        suppressErrorLog: true,
                        url: 'http://localhost:3211',
                    }
                );

                const config = axiosMock.mock.calls[0][0];
                expect(
                    Object.prototype.hasOwnProperty.call(
                        config,
                        'transformResponse'
                    )
                ).toBe(false);
                expect(getDefaultsReadCount()).toBe(0);
                expect(events).toEqual([]);
            } finally {
                phaseChannel.unsubscribe(subscriber);
            }
        }
    );

    it('pairs one final JSON phase across redirects and marks the ready response', async () => {
        await loadXtreamEvents('1');
        const events: MainPhaseEvent[] = [];
        const phaseChannel = channel(
            XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL
        );
        const subscriber = (event: unknown) =>
            events.push(event as MainPhaseEvent);
        phaseChannel.subscribe(subscriber);
        let finalPayload: unknown;
        try {
            axiosMock
                .mockImplementationOnce((config: AxiosRequestConfig) =>
                    Promise.resolve({
                        config,
                        data: applyConfiguredTransforms(
                            config,
                            '{"redirect":true}',
                            302
                        ),
                        headers: { location: '/final' },
                        status: 302,
                        statusText: 'Found',
                    })
                )
                .mockImplementationOnce((config: AxiosRequestConfig) => {
                    finalPayload = applyConfiguredTransforms(
                        config,
                        '{"items":[1,2,3]}',
                        200
                    );
                    return Promise.resolve({
                        config,
                        data: finalPayload,
                        headers: {},
                        status: 200,
                        statusText: 'OK',
                    });
                });

            const result = (await getHandler('XTREAM_REQUEST')(
                {},
                {
                    params: {
                        action: 'get_live_categories',
                        password: 'provider-password-secret',
                        username: 'provider-user-secret',
                    },
                    requestId: 'xtream-mabc1005-5',
                    sessionId: 'xtream-session-1',
                    suppressErrorLog: true,
                    url: 'http://localhost:3211',
                }
            )) as { action: string; payload: unknown };

            expect(result.payload).toBe(finalPayload);
            expect(result.action).toBe('get_live_categories');
            expect(getDefaultsReadCount()).toBe(1);
            expect(mockParseTransform).toHaveBeenCalledTimes(2);
            expect(mockFinalizeTransform).toHaveBeenCalledTimes(2);
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
                {
                    boundary: 'start',
                    phase: XTREAM_MAIN_PERFORMANCE_PHASE.RESPONSE_READY,
                },
                {
                    boundary: 'end',
                    phase: XTREAM_MAIN_PERFORMANCE_PHASE.RESPONSE_READY,
                },
            ]);
            const serialized = JSON.stringify(events);
            expect(serialized).not.toContain('localhost');
            expect(serialized).not.toContain('provider-user-secret');
            expect(serialized).not.toContain('provider-password-secret');
            expect(serialized).not.toContain('items');
        } finally {
            phaseChannel.unsubscribe(subscriber);
        }
    });

    it('closes network and cancel dispatch exactly once without a response-ready marker on abort', async () => {
        await loadXtreamEvents('1');
        const enteredAxios = createDeferred<void>();
        const cancelError = Object.assign(new Error('cancelled'), {
            code: 'ERR_CANCELED',
        });
        let signal: AbortSignal | undefined;
        axiosMock.mockImplementation((config: AxiosRequestConfig) => {
            signal = config.signal as AbortSignal;
            enteredAxios.resolve();
            return new Promise((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(cancelError), {
                    once: true,
                });
            });
        });
        axiosMock.isAxiosError.mockImplementation(
            (error: unknown) => error === cancelError
        );
        const events: MainPhaseEvent[] = [];
        const phaseChannel = channel(
            XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL
        );
        const subscriber = (event: unknown) =>
            events.push(event as MainPhaseEvent);
        phaseChannel.subscribe(subscriber);
        try {
            const request = getHandler('XTREAM_REQUEST')(
                {},
                {
                    params: {
                        action: 'get_live_streams',
                        password: 'secret',
                        username: 'user',
                    },
                    requestId: 'xtream-mabc1006-6',
                    sessionId: 'xtream-session-abort',
                    suppressErrorLog: true,
                    url: 'http://localhost:3211',
                }
            ) as Promise<unknown>;
            await enteredAxios.promise;

            await expect(
                getHandler(XTREAM_CANCEL_SESSION)({}, 'xtream-session-abort')
            ).resolves.toEqual({ cancelled: 1, success: true });
            await expect(request).rejects.toMatchObject({
                name: 'AbortError',
                status: 499,
            });
            expect(signal?.aborted).toBe(true);
            expect(
                events.map(({ boundary, phase }) => ({ boundary, phase }))
            ).toEqual([
                {
                    boundary: 'start',
                    phase: XTREAM_MAIN_PERFORMANCE_PHASE.NETWORK_TOTAL,
                },
                {
                    boundary: 'start',
                    phase: XTREAM_MAIN_PERFORMANCE_PHASE.CANCEL_SESSION,
                },
                {
                    boundary: 'end',
                    phase: XTREAM_MAIN_PERFORMANCE_PHASE.CANCEL_SESSION,
                },
                {
                    boundary: 'end',
                    phase: XTREAM_MAIN_PERFORMANCE_PHASE.NETWORK_TOTAL,
                },
            ]);
        } finally {
            phaseChannel.unsubscribe(subscriber);
        }
    });
});
