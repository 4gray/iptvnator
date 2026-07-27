import { DEBUG_TRACE_EVENT_CHANNEL } from '../services/debug-trace';
import {
    createPreloadPerformanceHarness,
    PRELOAD_ENVIRONMENT,
    type PreloadPerformanceHarness,
} from './main.preload.performance.test-helpers';

describe('main preload Xtream performance marker gates', () => {
    let harness: PreloadPerformanceHarness;

    beforeEach(() => {
        harness = createPreloadPerformanceHarness();
    });

    afterEach(() => {
        harness.cleanup();
        jest.restoreAllMocks();
    });

    it.each([
        undefined,
        '',
        '0',
        'false',
        'true',
        ' TRUE ',
        'yes',
        'On',
        ' 1 ',
    ])(
        'requires the exact performance flag value 1, not %p',
        async (flagValue) => {
            await harness.load(
                flagValue === undefined
                    ? {}
                    : {
                          [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: flagValue,
                      }
            );

            await harness.getApi().dbGetContent('playlist-1', 'live');

            expect(harness.getXtreamMarkers()).toEqual([]);
        }
    );

    it('enables the Xtream marker only for the exact value 1', async () => {
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });

        await harness.getApi().dbGetContent('playlist-1', 'live');

        expect(harness.getXtreamMarkers()).toHaveLength(2);
    });

    it('does no Xtream clock or metadata work while its exact gate is disabled', async () => {
        const clock = jest
            .spyOn(globalThis.performance, 'now')
            .mockImplementation(() => {
                throw new Error('clock must stay idle');
            });
        const payload = new Proxy(
            {},
            {
                get: () => {
                    throw new Error('metadata must stay opaque');
                },
            }
        );
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: 'true',
        });

        await expect(
            harness.getApi().xtreamRequest(payload as never)
        ).resolves.toEqual({ success: true });

        expect(clock).not.toHaveBeenCalled();
        expect(harness.getXtreamMarkers()).toEqual([]);
        expect(harness.ipcRenderer.invoke.mock.calls[0][0]).toBe(
            'XTREAM_REQUEST'
        );
        expect(harness.ipcRenderer.invoke.mock.calls[0][1]).toBe(payload);
    });

    it('does not inspect or mark non-target methods in performance-only mode', async () => {
        const settings = new Proxy(
            {},
            {
                get: () => {
                    throw new Error('non-target data must stay opaque');
                },
            }
        );
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });

        await harness.getApi().updateSettings(settings);

        expect(harness.getXtreamMarkers()).toEqual([]);
        expect(harness.ipcRenderer.invoke.mock.calls[0][0]).toBe(
            'SETTINGS_UPDATE'
        );
        expect(harness.ipcRenderer.invoke.mock.calls[0][1]).toBe(settings);
    });

    it('keeps trace-only Xtream calls on the existing debug channel', async () => {
        await harness.load({
            [PRELOAD_ENVIRONMENT.TRACE_IPC]: '1',
        });

        await harness.getApi().dbGetContent('playlist-1', 'live');

        expect(
            harness
                .getSentPayloads<Record<string, unknown>>(
                    DEBUG_TRACE_EVENT_CHANNEL
                )
                .map(({ method, phase }) => ({ method, phase }))
        ).toEqual([
            { method: 'dbGetContent', phase: 'start' },
            { method: 'dbGetContent', phase: 'success' },
        ]);
        expect(harness.getXtreamMarkers()).toEqual([]);
    });

    it('keeps both debug tracing and Xtream markers when both exact gates are enabled', async () => {
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
            [PRELOAD_ENVIRONMENT.TRACE_IPC]: '1',
        });

        await harness.getApi().dbGetContent('playlist-1', 'live');

        expect(harness.getSentPayloads(DEBUG_TRACE_EVENT_CHANNEL)).toHaveLength(
            2
        );
        expect(harness.getXtreamMarkers()).toHaveLength(2);
    });

    it('keeps the bridge fail-neutral when marker delivery fails', async () => {
        const result = { success: true };
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });
        harness.ipcRenderer.invoke.mockResolvedValueOnce(result);
        harness.ipcRenderer.send.mockImplementation((channel: string) => {
            if (channel === 'IPTVNATOR_XTREAM_PERF_CAPTURE_MARKER') {
                throw new Error('marker sink failure');
            }
        });

        await expect(
            harness.getApi().dbGetContent('playlist-1', 'live')
        ).resolves.toBe(result);
        expect(harness.ipcRenderer.invoke).toHaveBeenCalledTimes(1);
    });

    it('keeps the bridge fail-neutral when the high-resolution clock fails', async () => {
        const result = { success: true };
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });
        harness.ipcRenderer.invoke.mockResolvedValueOnce(result);
        jest.spyOn(globalThis.performance, 'now').mockImplementation(() => {
            throw new Error('clock failure');
        });

        await expect(
            harness.getApi().dbGetContent('playlist-1', 'live')
        ).resolves.toBe(result);
        expect(
            harness
                .getXtreamMarkers()
                .every(({ sourceEpochMs }) => Number.isFinite(sourceEpochMs))
        ).toBe(true);
    });
});
