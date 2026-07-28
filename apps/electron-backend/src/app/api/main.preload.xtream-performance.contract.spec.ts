import {
    PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    type XtreamPreloadPerformanceMarker,
} from '@iptvnator/shared/interfaces';
import {
    createPreloadPerformanceHarness,
    createRefreshPayload,
    PRELOAD_ENVIRONMENT,
    type PreloadPerformanceHarness,
} from './main.preload.performance.test-helpers';
import {
    XTREAM_PRELOAD_REQUEST_PAYLOAD,
    XTREAM_PRELOAD_TARGET_CASES,
} from './main.preload.xtream-performance.spec-data';

const MARKER_KEYS = [
    'action',
    'boundary',
    'categoryType',
    'contentType',
    'ipcCallId',
    'itemCount',
    'method',
    'operationId',
    'outcome',
    'playlistId',
    'schemaVersion',
    'sessionId',
    'sourceEpochMs',
] as const;

describe('main preload Xtream performance marker contract', () => {
    let harness: PreloadPerformanceHarness;

    beforeEach(() => {
        harness = createPreloadPerformanceHarness();
    });

    afterEach(() => {
        harness.cleanup();
        jest.restoreAllMocks();
    });

    it.each(XTREAM_PRELOAD_TARGET_CASES)(
        'marks $method without changing IPC arguments or result identity',
        async ({ expectedInvoke, expectedMetadata, invoke, method }) => {
            const result = new Proxy({}, { get: () => undefined });
            await harness.load({
                [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
            });
            harness.ipcRenderer.invoke.mockResolvedValueOnce(result);

            await expect(
                Promise.resolve(invoke(harness.getApi()))
            ).resolves.toBe(result);

            expect(harness.ipcRenderer.invoke).toHaveBeenCalledTimes(1);
            expect(harness.ipcRenderer.invoke).toHaveBeenCalledWith(
                ...expectedInvoke
            );
            const markers = harness.getXtreamMarkers();
            expect(markers).toHaveLength(2);
            expect(markers).toEqual([
                expect.objectContaining({
                    ...expectedMetadata,
                    boundary: 'start',
                    ipcCallId: 1,
                    method,
                    outcome: null,
                    schemaVersion: 1,
                }),
                expect.objectContaining({
                    ...expectedMetadata,
                    boundary: 'end',
                    ipcCallId: 1,
                    method,
                    outcome: 'success',
                    schemaVersion: 1,
                }),
            ]);
            expectFixedMarkerShape(markers);
        }
    );

    it('preserves exact rejection and synchronous throw identities', async () => {
        const rejection = new Error('provider-error-secret');
        const synchronousError = new Error('provider-sync-secret');
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });
        harness.ipcRenderer.invoke.mockRejectedValueOnce(rejection);

        await expect(
            harness.getApi().dbGetContent('playlist-1', 'live')
        ).rejects.toBe(rejection);
        expect(
            harness.getXtreamMarkers().map(({ outcome }) => outcome)
        ).toEqual([null, 'error']);

        harness.ipcRenderer.invoke.mockImplementationOnce(() => {
            throw synchronousError;
        });
        expect(() => harness.getApi().dbCancelOperation('operation-1')).toThrow(
            synchronousError
        );
        expect(
            harness.getXtreamMarkers().map(({ outcome }) => outcome)
        ).toEqual([null, 'error', null, 'error']);
    });

    it('preserves a synchronous target return identity', async () => {
        const result = { synchronous: true };
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });
        harness.ipcRenderer.invoke.mockReturnValueOnce(result);

        const actual = harness
            .getApi()
            .dbCancelOperation('operation-1') as unknown;

        expect(actual).toBe(result);
        expect(
            harness.getXtreamMarkers().map(({ outcome }) => outcome)
        ).toEqual([null, 'success']);
    });

    it('keeps M3U and Xtream protocols on their own channels', async () => {
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });

        await harness.getApi().refreshPlaylist(createRefreshPayload());
        await harness.getApi().xtreamRequest(XTREAM_PRELOAD_REQUEST_PAYLOAD);

        expect(harness.getMarkers()).toHaveLength(2);
        expect(harness.getXtreamMarkers()).toHaveLength(2);
        expect(
            harness.getSentPayloads(PRELOAD_PERFORMANCE_MARKER_CHANNEL)
        ).toEqual(harness.getMarkers());
        expect(
            harness.getSentPayloads(XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL)
        ).toEqual(harness.getXtreamMarkers());
        expect(
            harness
                .getMarkers()
                .every(({ method }) => method === 'refreshPlaylist')
        ).toBe(true);
        expect(
            harness
                .getXtreamMarkers()
                .every(({ method }) => method === 'xtreamRequest')
        ).toBe(true);
    });
});

function expectFixedMarkerShape(
    markers: XtreamPreloadPerformanceMarker[]
): void {
    for (const [index, marker] of markers.entries()) {
        expect(Object.keys(marker).sort()).toEqual([...MARKER_KEYS].sort());
        expect(Number.isFinite(marker.sourceEpochMs)).toBe(true);
        if (index > 0) {
            expect(marker.sourceEpochMs).toBeGreaterThanOrEqual(
                markers[index - 1].sourceEpochMs
            );
        }
    }
    const serialized = JSON.stringify(markers);
    for (const forbidden of [
        'provider-password-secret',
        'provider-user-secret',
        'provider-url-secret',
        'request-secret',
        'secret-title',
        'secret-stream-title',
        'secret-favorite-title',
        'secret-recent-title',
        'provider-search-secret',
        'global-search-secret',
        'secret-source',
        'provider-error-secret',
    ]) {
        expect(serialized).not.toContain(forbidden);
    }
}
