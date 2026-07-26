import {
    PRELOAD_PERFORMANCE_CORRELATION_STATE,
    PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    PRELOAD_PERFORMANCE_METHOD,
    type Settings,
    Theme,
} from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import { DEBUG_TRACE_EVENT_CHANNEL } from '../services/debug-trace';
import {
    createPreloadPerformanceHarness,
    PRELOAD_ENVIRONMENT,
    type PreloadPerformanceHarness,
} from './main.preload.performance.test-helpers';

describe('main preload performance marker gates', () => {
    let harness: PreloadPerformanceHarness;

    beforeEach(() => {
        harness = createPreloadPerformanceHarness();
    });

    afterEach(() => {
        harness.cleanup();
        jest.restoreAllMocks();
    });

    it.each([undefined, '', '0', 'false', 'no', 'off'])(
        'emits no marker when the performance flag is %s',
        async (flagValue) => {
            await harness.load(
                flagValue === undefined
                    ? {}
                    : {
                          [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: flagValue,
                      }
            );

            await harness.getApi().dbGetAppPlaylist('playlist-1');

            expect(harness.getMarkers()).toEqual([]);
        }
    );

    it.each(['1', ' TRUE ', 'yes', 'On'])(
        'accepts the existing true flag value %s',
        async (flagValue) => {
            await harness.load({
                [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: flagValue,
            });

            await harness.getApi().dbGetAppPlaylist('playlist-1');

            expect(
                harness.getMarkers().map(({ correlationState, phase }) => ({
                    correlationState,
                    phase,
                }))
            ).toEqual([
                {
                    correlationState:
                        PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
                    phase: 'start',
                },
                {
                    correlationState:
                        PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
                    phase: 'success',
                },
            ]);
        }
    );

    it('keeps trace-only calls on the existing debug channel', async () => {
        await harness.load({
            [PRELOAD_ENVIRONMENT.TRACE_IPC]: '1',
        });

        await harness.getApi().dbGetAppPlaylist('playlist-1');

        expect(
            harness
                .getSentPayloads<
                    Record<string, unknown>
                >(DEBUG_TRACE_EVENT_CHANNEL)
                .map(({ method, phase }) => ({ method, phase }))
        ).toEqual([
            {
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                phase: 'start',
            },
            {
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                phase: 'success',
            },
        ]);
        expect(harness.getMarkers()).toEqual([]);
    });

    it('keeps debug tracing unchanged when both gates are enabled', async () => {
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
            [PRELOAD_ENVIRONMENT.TRACE_IPC]: '1',
        });

        await harness.getApi().dbGetAppPlaylist('playlist-1');

        expect(
            harness
                .getSentPayloads<
                    Record<string, unknown>
                >(DEBUG_TRACE_EVENT_CHANNEL)
                .map(({ method, phase }) => ({ method, phase }))
        ).toEqual([
            {
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                phase: 'start',
            },
            {
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                phase: 'success',
            },
        ]);
        expect(
            harness.getSentPayloads(PRELOAD_PERFORMANCE_MARKER_CHANNEL).length
        ).toBe(2);
    });

    it('does not inspect or mark non-target calls in performance-only mode', async () => {
        const result = { success: true };
        const settings = Object.defineProperty({}, 'sentinel', {
            enumerable: true,
            get: () => {
                throw new Error('non-target arguments must stay opaque');
            },
        }) as Partial<Settings>;
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });
        harness.ipcRenderer.invoke.mockResolvedValueOnce(result);

        await expect(harness.getApi().updateSettings(settings)).resolves.toBe(
            result
        );

        expect(harness.ipcRenderer.invoke).toHaveBeenCalledWith(
            'SETTINGS_UPDATE',
            settings
        );
        expect(harness.getMarkers()).toEqual([]);
    });

    it('preserves the full legacy trace payload for non-target success', async () => {
        const settings = {
            password: 'sentinel-argument-secret',
            theme: Theme.DarkTheme,
        } as Partial<Settings>;
        const result = {
            password: 'sentinel-result-secret',
            success: true,
        };
        await harness.load({
            [PRELOAD_ENVIRONMENT.TRACE_IPC]: '1',
        });
        jest.spyOn(globalThis.performance, 'now')
            .mockReturnValueOnce(10)
            .mockReturnValueOnce(12.34);
        harness.ipcRenderer.invoke.mockResolvedValueOnce(result);

        await expect(harness.getApi().updateSettings(settings)).resolves.toBe(
            result
        );

        const traces = harness.getSentPayloads<Record<string, unknown>>(
            DEBUG_TRACE_EVENT_CHANNEL
        );
        expect(traces).toEqual([
            {
                args: {
                    items: [
                        {
                            password: 'sentinel-argument-secret',
                            theme: Theme.DarkTheme,
                        },
                    ],
                    length: 1,
                    type: 'array',
                },
                method: 'updateSettings',
                phase: 'start',
            },
            {
                durationMs: 2.3,
                method: 'updateSettings',
                phase: 'success',
                result,
            },
        ]);
        const redacted = JSON.stringify(redactSensitiveData(traces));
        expect(redacted).not.toContain('sentinel-argument-secret');
        expect(redacted).not.toContain('sentinel-result-secret');
        expect(harness.getMarkers()).toEqual([]);
    });

    it('preserves the full legacy trace payload for non-target errors', async () => {
        const rejection = new Error('token=sentinel-error-secret');
        await harness.load({
            [PRELOAD_ENVIRONMENT.TRACE_IPC]: '1',
        });
        jest.spyOn(globalThis.performance, 'now')
            .mockReturnValueOnce(20)
            .mockReturnValueOnce(23.26);
        harness.ipcRenderer.invoke.mockRejectedValueOnce(rejection);

        await expect(
            harness.getApi().updateSettings({ theme: Theme.LightTheme })
        ).rejects.toBe(rejection);

        const traces = harness.getSentPayloads<Record<string, unknown>>(
            DEBUG_TRACE_EVENT_CHANNEL
        );
        expect(traces).toEqual([
            {
                args: {
                    items: [{ theme: Theme.LightTheme }],
                    length: 1,
                    type: 'array',
                },
                method: 'updateSettings',
                phase: 'start',
            },
            {
                durationMs: 3.3,
                error: {
                    message: rejection.message,
                    name: 'Error',
                },
                method: 'updateSettings',
                phase: 'error',
            },
        ]);
        expect(JSON.stringify(redactSensitiveData(traces))).not.toContain(
            'sentinel-error-secret'
        );
        expect(harness.getMarkers()).toEqual([]);
    });
});
