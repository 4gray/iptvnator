import type { AxiosRequestConfig } from 'axios';
import {
    XTREAM_MAIN_PERFORMANCE_PHASE,
    XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL,
    type PerformancePhaseEvent,
    type XtreamMainPerformancePhase,
} from '@iptvnator/shared/interfaces';
import { channel } from 'node:diagnostics_channel';
import {
    applyConfiguredTransforms,
    axiosMock,
    getHandler,
    loadXtreamEvents,
    mockParseTransform,
} from './xtream.events.performance.test-helpers';

type MainPhaseEvent = PerformancePhaseEvent<XtreamMainPerformancePhase>;

function expectFailedResponsePhases(events: MainPhaseEvent[]): void {
    expect(events.map(({ boundary, phase }) => ({ boundary, phase }))).toEqual([
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
    expect(
        events.some(
            ({ phase }) =>
                phase === XTREAM_MAIN_PERFORMANCE_PHASE.RESPONSE_READY
        )
    ).toBe(false);
}

describe('XtreamEvents failed-response performance phases', () => {
    const originalCaptureValue = process.env['IPTVNATOR_PERF_CAPTURE'];

    afterEach(() => {
        if (originalCaptureValue === undefined) {
            delete process.env['IPTVNATOR_PERF_CAPTURE'];
        } else {
            process.env['IPTVNATOR_PERF_CAPTURE'] = originalCaptureValue;
        }
    });

    it('closes JSON and network phases without marking an Axios error response ready', async () => {
        await loadXtreamEvents('1');
        const events: MainPhaseEvent[] = [];
        const phaseChannel = channel(
            XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL
        );
        const subscriber = (event: unknown) =>
            events.push(event as MainPhaseEvent);
        phaseChannel.subscribe(subscriber);
        try {
            let axiosError: Error & {
                response?: {
                    data: unknown;
                    headers: object;
                    status: number;
                    statusText: string;
                };
            };
            axiosMock.mockImplementation((config: AxiosRequestConfig) => {
                axiosError = Object.assign(new Error('provider unavailable'), {
                    response: {
                        data: applyConfiguredTransforms(
                            config,
                            '{"message":"provider unavailable"}',
                            503
                        ),
                        headers: {},
                        status: 503,
                        statusText: 'Unavailable',
                    },
                });
                axiosMock.isAxiosError.mockImplementation(
                    (error: unknown) => error === axiosError
                );
                return Promise.reject(axiosError);
            });

            await expect(
                getHandler('XTREAM_REQUEST')(
                    {},
                    {
                        params: {
                            action: 'get_live_categories',
                            password: 'provider-password-secret',
                            username: 'provider-user-secret',
                        },
                        requestId: 'xtream-mabc1007-7',
                        sessionId: 'xtream-session-error',
                        suppressErrorLog: true,
                        url: 'http://localhost:3211',
                    }
                )
            ).rejects.toEqual({
                message: 'provider unavailable',
                status: 503,
                type: 'ERROR',
            });

            expectFailedResponsePhases(events);
        } finally {
            phaseChannel.unsubscribe(subscriber);
        }
    });

    it('closes a fulfilled 4xx response without marking an IPC result ready', async () => {
        await loadXtreamEvents('1');
        const events: MainPhaseEvent[] = [];
        const phaseChannel = channel(
            XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL
        );
        const subscriber = (event: unknown) =>
            events.push(event as MainPhaseEvent);
        phaseChannel.subscribe(subscriber);
        try {
            axiosMock.mockImplementation((config: AxiosRequestConfig) =>
                Promise.resolve({
                    config,
                    data: applyConfiguredTransforms(
                        config,
                        '{"message":"not found"}',
                        404
                    ),
                    headers: {},
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await expect(
                getHandler('XTREAM_REQUEST')(
                    {},
                    {
                        params: { action: 'get_live_categories' },
                        requestId: 'xtream-mabc1008-8',
                        suppressErrorLog: true,
                        url: 'http://localhost:3211',
                    }
                )
            ).rejects.toEqual({
                message: 'HTTP Error: Not Found',
                status: 404,
            });
            expectFailedResponsePhases(events);
        } finally {
            phaseChannel.unsubscribe(subscriber);
        }
    });

    it('preserves an exact default-transform error while closing JSON and network once', async () => {
        await loadXtreamEvents('1');
        const transformError = new Error('default transform failed');
        mockParseTransform.mockImplementationOnce(() => {
            throw transformError;
        });
        axiosMock.mockImplementation((config: AxiosRequestConfig) =>
            Promise.resolve({
                config,
                data: applyConfiguredTransforms(config, '{"items":[]}', 200),
                headers: {},
                status: 200,
                statusText: 'OK',
            })
        );
        const events: MainPhaseEvent[] = [];
        const phaseChannel = channel(
            XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL
        );
        const subscriber = (event: unknown) =>
            events.push(event as MainPhaseEvent);
        phaseChannel.subscribe(subscriber);
        try {
            await expect(
                getHandler('XTREAM_REQUEST')(
                    {},
                    {
                        params: { action: 'get_live_categories' },
                        requestId: 'xtream-mabc1009-9',
                        suppressErrorLog: true,
                        url: 'http://localhost:3211',
                    }
                )
            ).rejects.toBe(transformError);
            expectFailedResponsePhases(events);
        } finally {
            phaseChannel.unsubscribe(subscriber);
        }
    });
});
