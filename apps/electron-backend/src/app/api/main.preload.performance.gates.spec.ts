import {
    PRELOAD_PERFORMANCE_CORRELATION_STATE,
    PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    PRELOAD_PERFORMANCE_METHOD,
    type Settings,
} from '@iptvnator/shared/interfaces';
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
});
